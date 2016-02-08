var Promise = require('bluebird')

function MockRedisClient (getValue) {
  var self = this
  self.getValue = getValue
  self.set = function set (key, value, cb) {
    self.setKey = key
    self.setValue = value
    process.nextTick(function () {
      return cb(null, 'OK')
    })
  }
  self.get = function get (key, cb) {
    self.getKey = key
    process.nextTick(function () {
      return cb(null, self.getValue)
    })
  }
  self.del = function del (key, cb) {
    self.delKey = key
    process.nextTick(function () {
      return cb(null, 1)
    })
  }
}

function MockOAuthApi (data) {
  var self = this
  self.data = data
  self.accessTokenRequest = function accessTokenRequest () {
    return self
  }
  self.userPass = function userPass (user, pass) {
    return self
  }
  self.exec = function exec (cb) {
    return new Promise(function (resolve, reject) {
      if (self.data instanceof Error) throw self.data
      return resolve(self.data)
    })
  }
}

function MockApi (userData, teamsData) {
  var self = this
  self.userData = self.data = userData
  self.teamsData = teamsData
  self.v2UserRequest = function v2UserRequest () {
    self.data = self.userData
    return self
  }
  self.v2TeamsByRoleRequest = function v2TeamsByRoleRequest (role) {
    self.data = self.teamsData
    return self
  }
  self.accessToken = function accessToken (token) {
    return self
  }
  self.get = function get (cb) {
    return new Promise(function (resolve, reject) {
      if (self.data instanceof Error) throw self.data
      return resolve(self.data)
    })
  }
}

module.exports = {
  MockRedisClient: MockRedisClient,
  MockOAuthApi: MockOAuthApi,
  MockApi: MockApi
}
