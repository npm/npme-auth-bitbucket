var BitbucketApi = require('./api')
var BitbucketOAuth2Api = require('./api-oauth2')
var errors = require('./errors')
var Promise = require('bluebird')
var Session = require('./session')

function Authenticator (opts) {
  opts = opts || {}
  this.oauthApi = opts.oauthApi || new BitbucketOAuth2Api({
    clientId: opts.bitbucketClientId || process.env.BITBUCKET_CLIENT_ID,
    clientSecret: opts.bitbucketClientSecret || process.env.BITBUCKET_CLIENT_SECRET,
    protocol: opts.bitbucketOauthProtocol || process.env.BITBUCKET_OAUTH_PROTOCOL,
    host: opts.bitbucketOauthHost || process.env.BITBUCKET_OAUTH_HOST,
    port: opts.bitbucketOauthPort || process.env.BITBUCKET_OAUTH_PORT
  })
  this.api = opts.api || new BitbucketApi({
    protocol: opts.bitbucketProtocol || process.env.BITBUCKET_PROTOCOL,
    host: opts.bitbucketHost || process.env.BITBUCKET_HOST,
    port: opts.bitbucketPort || process.env.BITBUCKET_PORT
  })
  this.bitbucketTeam = opts.bitbucketTeam || process.env.BITBUCKET_TEAM
  this.opts = opts // allows us to lazily create a session
}

Authenticator.prototype.authenticate = function (credentials, cb) {
  if (!this._validateCredentials(credentials)) return Promise.reject(errors.forCode(500, 'Invalid credentials format')).nodeify(cb)

  return this._authenticate(credentials.body).nodeify(cb)
}

Authenticator.prototype._authenticate = function (credentialsBody) {
  var getAuthToken = this._getAuthorizationToken(credentialsBody)
  var getSession = this._getSession(getAuthToken)
  var storeRefreshToken = this._storeRefreshToken(getSession, getAuthToken)
  return storeRefreshToken.return(getAuthToken)
}

Authenticator.prototype.unauthenticate = function (token, cb) {
  var getSession = this._getSession(true)
  var dropRefreshToken = this._dropRefreshToken(getSession, token)
  return dropRefreshToken.catch(function (err) {
    console.error(err) // basically ignore
  }).nodeify(cb)
}

Authenticator.prototype._validateCredentials = function (credentials) {
  return Boolean(credentials && credentials.body && credentials.body.email && credentials.body.password)
}

Authenticator.prototype._getAuthorizationToken = function (credentialsBody) {
  var self = this
  credentialsBody = credentialsBody || {}
  var email = credentialsBody.email || ''
  var password = credentialsBody.password
  var tokenRequest = self.oauthApi.accessTokenRequest().userPass(email, password)
  if (credentialsBody.refreshToken) tokenRequest = tokenRequest.refreshToken(credentialsBody.refreshToken)
  var getAuth = Promise.resolve(tokenRequest.exec())
    .then(function (data) {
      return {
        // as expected by npm-auth-ws
        token: data.access_token,
        user: {
          name: credentialsBody.name || email.substring(0, email.indexOf('@')),
          email: email
        },
        // for local logic to store refresh token
        refreshToken: data.refresh_token
      }
    })
    .then(function (auth) {
      return Promise.resolve(self.api.v2UserRequest().accessToken(auth.token).get())
        .then(function (user) {
          auth.user.name = user.username
          return auth
        })
    })
  if (self.bitbucketTeam) {
    getAuth = getAuth.then(function (auth) {
      return Promise.resolve(self.api.v2TeamsByRoleRequest('member').accessToken(auth.token).get())
        .then(function (teams) {
          if (teams && teams.values) {
            for (var i = 0; i < teams.values.length; i++) {
              if (teams.values[i].username === self.bitbucketTeam) return auth
            }
          }
          return Promise.reject(errors.forCode(401, 'Not a member of team ' + self.bitbucketTeam))
        })
    })
  }
  return getAuth
}

Authenticator.prototype._getSession = function (precondition) {
  var self = this
  return Promise.resolve(precondition).then(function (predicate) {
    if (!predicate) return null
    if (!self.session) self.session = new Session(self.opts)
    return self.session
  })
}

Authenticator.prototype._storeRefreshToken = function (getSession, getAuthToken) {
  return Promise.join(getSession, getAuthToken)
    .spread(function (session, authentication) {
      if (!session || !authentication) return Promise.resolve(null)
      return session.setRefreshToken(authentication.token, authentication.refreshToken)
    })
}

Authenticator.prototype._dropRefreshToken = function (getSession, token) {
  return Promise.resolve(getSession).then(function (session) {
    return session.delRefreshToken(token)
  })
}

Authenticator.prototype.end = function () {
  if (this.session) this.session.end()
}

module.exports = Authenticator
