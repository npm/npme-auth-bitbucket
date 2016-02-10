var Authenticator = require('./authenticator')
var BitbucketApi = require('./api')
var errors = require('./errors')
var got = require('got')
var parseGitUrl = require('github-url-from-git')
var Promise = require('bluebird')
var Session = require('./session')
var urlParser = require('url')

function Authorizer (opts) {
  opts = opts || {}
  this.opts = opts
  this.frontDoorHost = opts.frontDoorHost || process.env.NPM_AUTH_FRONTDOOR_HOST
  this.sharedFetchSecret = opts.sharedFetchSecret || process.env.NPM_AUTH_SHARED_FETCH_SECRET
  this.bitbucketTeam = opts.bitbucketTeam || process.env.BITBUCKET_TEAM
  this.api = opts.api || new BitbucketApi({
    protocol: opts.bitbucketProtocol || process.env.BITBUCKET_PROTOCOL,
    host: opts.bitbucketHost || process.env.BITBUCKET_HOST,
    port: opts.bitbucketPort || process.env.BITBUCKET_PORT
  })
  this.authenticator = opts.authenticator || new Authenticator(opts)
}

Authorizer.prototype.authorize = function (credentials, cb) {
  var clientToken = this._extractToken(credentials)
  if (!clientToken) return Promise.reject(errors.forCode(404)).nodeify(cb)

  var scope
  switch (credentials.method) {
    case 'GET':
      scope = 'read'
      break
    case 'PUT':
    case 'POST':
    case 'DELETE':
      scope = 'write'
      break
    default:
      return Promise.reject(errors.forCode(405, 'Unsupported method: ' + credentials.method)).nodeify(cb)
  }

  var packagePath = credentials.path
  var untrustedPackageJson = credentials.body

  var loadPackageJson = this._loadPackageJson(packagePath, untrustedPackageJson)
  var parseGitUrl = this._parseGitUrl(loadPackageJson)
  var checkTeam = this._checkTeam(parseGitUrl)
  var checkAuthorized = this._checkAuthorized(checkTeam, clientToken, scope)
  return checkAuthorized.nodeify(cb)
}

Authorizer.prototype.whoami = function (credentials, cb) {
  var clientToken = this._extractToken(credentials)
  if (!clientToken) return Promise.reject(errors.forCode(404)).nodeify(cb)

  var self = this
  var getSession = self._getSession()
  var getServerToken = self._getServerToken(getSession, clientToken)
  return Promise.resolve(getServerToken).then(function (token) {
    return self._getUser(getSession, token)
  }).nodeify(cb)
}

Authorizer.prototype._extractToken = function (credentials) {
  var token = null
  if (credentials && credentials.headers && credentials.headers.authorization && credentials.headers.authorization.match(/Bearer /)) {
    token = credentials.headers.authorization.replace('Bearer ', '')
  }
  return token
}

Authorizer.prototype._loadPackageJson = function (packagePath, untrustedPackageJson) {
  var self = this
  return Promise.join(packagePath, untrustedPackageJson).spread(function (pkgPath, untrustedJson) {
    return got(urlParser.resolve(self.frontDoorHost, pkgPath + '?sharedFetchSecret=' + self.sharedFetchSecret), { json: true })
      .then(function (response) {
        if (response.body.repository) return response.body
        return Promise.try(function () {
          return untrustedJson.versions[untrustedJson['dist-tags'].latest]
        })
      })
      .catch(function (err) {
        if (err.statusCode === 404) {
          return Promise.try(function () {
            return untrustedJson.versions[untrustedJson['dist-tags'].latest]
          })
        }
        console.error('Unexpected error fetching package.json for ' + pkgPath, err)
        return Promise.reject(errors.forCode(err.statusCode))
      })
  })
}

Authorizer.prototype._parseGitUrl = function (loadPackageJson) {
  return Promise.resolve(loadPackageJson).then(function (packageJson) {
    var url = packageJson.repository.url
    if (url.match(/^(git:\/\/|git@)/)) url = parseGitUrl(url, { extraBaseUrls: /[^/]+/.source })
    var parsedUrl = urlParser.parse(url)
    var splitTeamRepo = parsedUrl.path.split('.git')[0].match(/^\/(.*)\/(.*)$/)
    if (!splitTeamRepo) return Promise.reject(errors.forCode(400, 'Does not appear to be a valid git url: ' + url))
    return {
      team: splitTeamRepo[1],
      repo: splitTeamRepo[2]
    }
  })
}

Authorizer.prototype._checkTeam = function (parseGitUrl) {
  var self = this
  return Promise.resolve(parseGitUrl).then(function (teamRepo) {
    if (self.bitbucketTeam && self.bitbucketTeam !== teamRepo.team) return Promise.reject(errors.forCode(400, 'Repo ' + teamRepo.repo + ' not under team ' + self.bitbucketTeam))
    return teamRepo
  })
}

Authorizer.prototype._checkAuthorized = function (checkTeam, clientToken, scope) {
  var self = this
  return Promise.resolve(checkTeam).then(function (teamRepo) {
    // don't get session until we know checkTeam has not erred
    var getSession = self._getSession()
    // swap client token for server token, in case we previously used a refresh token behind the scenes
    var getServerToken = self._getServerToken(getSession, clientToken)
    return Promise.resolve(getServerToken).then(function (token) {
      var getUser = self._getUser(getSession, token)
      return Promise.resolve(getUser).then(function (user) {
        // get user-specific privileges and check against scope
        var privilegesRequest = self.api.v1RepoPrivilegesForUserRequest(teamRepo.team, teamRepo.repo, user.name).accessToken(token)
        var getPrivileges = Promise.resolve(privilegesRequest.get()).catch(function (err) {
          if (err.statusCode !== 401) {
            console.error('Unexpected error from Bitbucket privileges API', err)
            return Promise.reject(errors.forCode(err.statusCode, err.message))
          }
          // try refresh token
          return Promise.resolve(getSession).then(function (session) {
            return Promise.resolve(session.getRefreshToken(token)).then(function (refreshToken) {
              if (!refreshToken) {
                return Promise.resolve(session.delAlias(clientToken))
                  .catch(function (redisErr) {
                    console.error('Ignoring redis error while attempting to delete alias: ' + clientToken, redisErr)
                  })
                  .then(function () {
                    return Promise.reject(errors.forCode(401, 'Please login again'))
                  })
              }
              return Promise.resolve(self.authenticator._authenticate({
                email: user.email,
                name: user.name,
                refreshToken: refreshToken
              }, true))
              .then(function (auth) {
                return Promise.join(
                  self.authenticator._unauthenticate(token, true),
                  Promise.resolve(session.setAlias(clientToken, auth.token)),
                  privilegesRequest.accessToken(auth.token).get()
                )
                .spread(function (ignore1, ignore2, privileges) {
                  return privileges
                })
              })
              .catch(function (error) {
                console.error('Ignoring ambiguous error', error)
                return Promise.join(session.delAlias(clientToken), session.delRefreshToken(token)).spread(function (delAliasResult, delRefreshResult) {
                  return false
                })
                .catch(function (redisError) {
                  console.error('Ignoring redis error on delete alias and refresh token: ' + clientToken, redisError)
                })
                .then(function () {
                  return Promise.reject(errors.forCode(401, 'Refresh token expired, please login again'))
                })
              })
            })
          })
        })
        return getPrivileges
          .then(function (privileges) {
            console.log('Privileges for ' + user.name + ' on repo ' + teamRepo.team + '/' + teamRepo.repo + ':', privileges)
            if (privileges && privileges[0] && privileges[0].privilege) {
              var p = privileges[0].privilege
              return Promise.resolve(Boolean(p === 'admin' || p === 'write' || p === scope))
            }
            return Promise.resolve(false)
          })
          .catch(function (err) {
            console.error('Error checking authorization for ' + user.name + ' on repo ' + teamRepo.team + '/' + teamRepo.repo, err)
            return Promise.reject(errors.forCode(err.statusCode, err.message))
          })
      })
    })
  })
}

Authorizer.prototype._getSession = function () {
  var self = this
  return Promise.try(function () {
    if (!self.session) self.session = new Session(self.opts)
    return self.session
  })
}

Authorizer.prototype._getServerToken = function (getSession, clientToken) {
  return Promise.resolve(getSession).then(function (session) {
    return session.getAlias(clientToken)
  })
  .then(function (serverToken) {
    return serverToken || clientToken
  })
  .catch(function (err) {
    console.error('Ignoring redis error on get alias: ' + clientToken, err)
    return clientToken
  })
}

Authorizer.prototype._getUser = function (getSession, token) {
  return Promise.resolve(getSession).then(function (session) {
    return session.getUser(token, false)
  })
}

Authorizer.prototype.end = function () {
  this.authenticator.end()
  if (this.session) this.session.end()
}

module.exports = Authorizer
