// var errors = require('./errors')
var Promise = require('bluebird')
var redis = require('redis')

function refreshTokenKey (accessToken) {
  return 'refresh-' + accessToken
}

// function consumerKey () {
//   return 'bitbucketConsumer'
// }

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
    .promisify(this.client.get, { context: this.client })(accessToken)
    .nodeify(cb)
}

// Session.prototype.setConsumer = function (consumer, cb) {
//   return Promise
//     .promisify(this.client.hmset, { context: this.client })(consumerKey(), consumer)
//     .nodeify(cb)
// }
//
// Session.prototype.getConsumer = function (cb) {
//   return Promise
//     .promisify(this.client.hgetall, { context: this.client })(consumerKey())
//     .nodeify(cb)
// }

/*
Session.prototype.set = function (key, obj, cb) {
  this.client.hmset(key, obj, function (err, result) {
    if (err) return cb(errors.forCode(500))
    return cb(null, result)
  })
}

Session.prototype.get = function (key, cb) {
  this.client.hgetall(key, function (err, obj) {
    if (err) return cb(errors.forCode(500))
    if (!obj) return cb(errors.forCode(404))

    return cb(null, obj)
  })
}
*/

Session.prototype.end = function () {
  this.client.end()
}

module.exports = Session
