var Promise = require('bluebird')
var redis = require('redis')

function refreshTokenKey (accessToken) {
  return 'refresh-' + accessToken
}

function userKey (accessToken) {
  return 'user-' + accessToken
}

function aliasKey (accessToken) {
  return 'alias-' + accessToken
}

function Session (opts) {
  this.client = opts.redisClient || redis.createClient(process.env.LOGIN_CACHE_REDIS)
}

Session.prototype.get = function (key, cb) {
  if (/^user-/.test(key)) return this.getUser(key.substring(5), true).nodeify(cb)
  return Promise
    .promisify(this.client.get, { context: this.client })(key)
    .then(function (jsonString) {
      return JSON.parse(jsonString)
    })
    .nodeify(cb)
}

Session.prototype.set = function (key, session, cb) {
  return Promise
    .promisify(this.client.set, { context: this.client })(key, JSON.stringify(session))
    .nodeify(cb)
}

Session.prototype.delete = function (key, cb) {
  return Promise
    .promisify(this.client.del, { context: this.client })(key)
    .nodeify(cb)
}

Session.prototype.setRefreshToken = function (accessToken, refreshToken) {
  return Promise
    .promisify(this.client.set, { context: this.client })(refreshTokenKey(accessToken), refreshToken)
}

Session.prototype.getRefreshToken = function (accessToken) {
  return Promise
    .promisify(this.client.get, { context: this.client })(refreshTokenKey(accessToken))
}

Session.prototype.delRefreshToken = function (accessToken) {
  return Promise
    .promisify(this.client.del, { context: this.client })(refreshTokenKey(accessToken))
}

Session.prototype.setUser = function (accessToken, user) {
  return Promise
    .promisify(this.client.set, { context: this.client })(userKey(accessToken), JSON.stringify(user))
}

Session.prototype.getUser = function (accessToken, tryAlias) {
  var self = this
  // swap client token for server token, in case we previously used a refresh token behind the scenes
  var getAlias = tryAlias ? self.getAlias(accessToken) : Promise.resolve(null)
  return getAlias
    .then(function (serverToken) {
      console.error('serverToken:', serverToken)
      console.error('accessToken:', accessToken)
      return serverToken || accessToken
    })
    .catch(function (err) {
      console.error('Ignoring redis error on get alias: ' + accessToken, err)
      return accessToken
    })
    .then(function (token) {
      return Promise
        .promisify(self.client.get, { context: self.client })(userKey(token))
        .then(function (jsonString) {
          return JSON.parse(jsonString)
        })
    })
}

Session.prototype.delUser = function (accessToken) {
  return Promise
    .promisify(this.client.del, { context: this.client })(userKey(accessToken))
}

Session.prototype.setAlias = function (clientToken, serverToken) {
  return Promise
    .promisify(this.client.set, { context: this.client })(aliasKey(clientToken), serverToken)
}

Session.prototype.getAlias = function (clientToken) {
  return Promise
    .promisify(this.client.get, { context: this.client })(aliasKey(clientToken))
}

Session.prototype.delAlias = function (clientToken) {
  return Promise
    .promisify(this.client.del, { context: this.client })(aliasKey(clientToken))
}

Session.prototype.end = function () {
  this.client.end()
}

module.exports = Session
