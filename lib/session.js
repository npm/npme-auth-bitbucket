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

Session.prototype.getUser = function (accessToken) {
  return Promise
    .promisify(this.client.get, { context: this.client })(userKey(accessToken))
    .then(function (jsonString) {
      return JSON.parse(jsonString)
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
