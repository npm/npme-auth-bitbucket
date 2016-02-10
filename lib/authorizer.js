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
  var token = this._extractToken(credentials)
  if (!token) return Promise.reject(errors.forCode(404)).nodeify(cb)

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
      return Promise.reject(errors.forCode(405, 'unsupported method')).nodeify(cb)
  }

  var packagePath = credentials.path
  var untrustedPackageJson = credentials.body

  var loadPackageJson = this._loadPackageJson(packagePath, untrustedPackageJson)
  var parseGitUrl = this._parseGitUrl(loadPackageJson)
  var checkTeam = this._checkTeam(parseGitUrl)
  var checkAuthorized = this._checkAuthorized(checkTeam, token, scope)
  return checkAuthorized.nodeify(cb)
}

Authorizer.prototype.whoami = function (credentials, cb) {
  var token = this._extractToken(credentials)
  if (!token) return Promise.reject(errors.forCode(404)).nodeify(cb)

  var getSession = this._getSession()
  var getUser = this._getUser(getSession, token)
  return getUser.nodeify(cb)
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
    if (!splitTeamRepo) return Promise.reject(errors.forCode(400, 'does not appear to be a valid git url'))
    return {
      team: splitTeamRepo[1],
      repo: splitTeamRepo[2]
    }
  })
}

Authorizer.prototype._checkTeam = function (parseGitUrl) {
  var self = this
  return Promise.resolve(parseGitUrl).then(function (teamRepo) {
    if (self.bitbucketTeam && self.bitbucketTeam !== teamRepo.team) return Promise.reject(errors.forCode(400, 'repo not under team ' + self.bitbucketTeam))
    return teamRepo
  })
}

Authorizer.prototype._checkAuthorized = function (checkTeam, token, scope) {
  var self = this
  return Promise.resolve(checkTeam).then(function (teamRepo) {
    // don't get session until we know checkTeam has not erred
    var getSession = self._getSession()
    var getUser = self._getUser(getSession, token)
    return Promise.resolve(getUser).then(function (user) {
      // get user-specific privileges and check against scope
      var privilegesRequest = self.api.v1RepoPrivilegesForUserRequest(teamRepo.team, teamRepo.repo, user.name).accessToken(token)
      var getPrivileges = Promise.resolve(privilegesRequest.get()).catch(function (err) {
        if (err.statusCode !== 401) return Promise.reject(errors.forCode(err.statusCode, err.message))
        // try refresh token
        return Promise.resolve(getSession).then(function (session) {
          return Promise.resolve(session.getRefreshToken(token)).then(function (refreshToken) {
            if (!refreshToken) return Promise.reject(errors.forCode(401, 'Please login again.'))
            return Promise.resolve(self.authenticator._authenticate({
              email: user.email,
              name: user.name,
              refreshToken: refreshToken
            }))
            .then(function (auth) {
              return Promise.join(self.authenticator.unauthenticate(token), privilegesRequest.accessToken(auth.token).get())
                .spread(function (ignore, privileges) {
                  return privileges
                })
            })
            .catch(function (error) {
              console.error(error)
              return Promise.reject(errors.forCode(401, 'Refresh token expired. Please login again.'))
            })
          })
        })
      })
      return getPrivileges
        .then(function (privileges) {
          if (privileges && privileges[0] && privileges[0].privilege) {
            var p = privileges[0].privilege
            return Promise.resolve(Boolean(p === 'admin' || p === 'write' || p === scope))
          }
          return Promise.resolve(false)
        })
        .catch(function (err) {
          return Promise.reject(errors.forCode(err.statusCode, err.message))
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

Authorizer.prototype._getUser = function (getSession, token) {
  return Promise.resolve(getSession).then(function (session) {
    return session.getUser(token)
  })
  .then(function (userData) {
    return JSON.parse(userData)
  })
}

Authorizer.prototype.end = function () {
  this.authenticator.end()
  if (this.session) this.session.end()
}

module.exports = Authorizer
