var Promise = require('bluebird')
var redis = require('redis')

function refreshTokenKey (accessToken) {
  return 'refresh-' + accessToken
}

function userKey (accessToken) {
  return 'user-' + accessToken
}

function Session (opts) {
  this.client = opts.redisClient || redis.createClient(process.env.LOGIN_CACHE_REDIS)
}

Session.prototype.setRefreshToken = function (accessToken, refreshToken, cb) {
  return Promise
    .promisify(this.client.set, { context: this.client })(refreshTokenKey(accessToken), refreshToken)
    .nodeify(cb)
}

Session.prototype.getRefreshToken = function (accessToken, cb) {
  return Promise
    .promisify(this.client.get, { context: this.client })(refreshTokenKey(accessToken))
    .nodeify(cb)
}

Session.prototype.delRefreshToken = function (accessToken, cb) {
  return Promise
    .promisify(this.client.del, { context: this.client })(refreshTokenKey(accessToken))
    .nodeify(cb)
}

Session.prototype.getUser = function (accessToken, cb) {
  return Promise
    .promisify(this.client.get, { context: this.client })(userKey(accessToken))
    .nodeify(cb)
}

Session.prototype.end = function () {
  this.client.end()
}

module.exports = Session
