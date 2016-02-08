var got = require('got')
var urlParser = require('url')
var verror = require('verror')

function BitbucketApi (opts) {
  if (!(this instanceof BitbucketApi)) return new BitbucketApi(opts)

  var self = this
  var _protocol = 'https'
  var _host = 'api.bitbucket.org'
  var _port = ''
  var _v1Prefix = '/1.0'
  var _v2Prefix = '/2.0'
  // var _accessToken

  // fluent config methods
  self.protocol = function protocol (p) {
    if (p) _protocol = p
    return self
  }

  self.host = function host (h) {
    if (h) _host = h
    return self
  }

  self.port = function port (p) {
    if (p) _port = p
    return self
  }

  self.v1Prefix = function v1Prefix (vp) {
    if (typeof vp === 'string') _v1Prefix = vp
    return self
  }

  self.v2Prefix = function v2Prefix (vp) {
    if (typeof vp === 'string') _v2Prefix = vp
    return self
  }

  self.url = function url (u) {
    if (!u) return self
    var parsedUrl = urlParser.parse(u)
    return self
      .protocol(parsedUrl.protocol.replace(':', ''))
      .host(parsedUrl.hostname)
      .port(parsedUrl.port)
  }

  // self.accessToken = function accessToken (t) {
  //   if (t) _accessToken = t
  //   return self
  // }

  // handle opts
  if (typeof opts === 'string') self.url(opts)
  else if (opts) {
    self
      .url(opts.url)
      .protocol(opts.protocol)
      .host(opts.host)
      .port(opts.port)
      .v1Prefix(opts.v1Prefix)
      .v2Prefix(opts.v2Prefix)
      // .accessToken(opts.accessToken)
  }

  // private methods
  function buildUrl (prefix, endpoint) {
    return _protocol + '://' + _host + (_port ? ':' + _port : '') + prefix + endpoint
  }

  function buildV1Req (endpoint) {
    return new BitbucketRequest(buildUrl(_v1Prefix, endpoint)) // .accessToken(_accessToken)
  }

  function buildV2Req (endpoint) {
    return new BitbucketRequest(buildUrl(_v2Prefix, endpoint)) // .accessToken(_accessToken)
  }

  // request methods: current user
  self.v1UserRequest = function v1UserRequest () {
    return buildV1Req('/user')
  }

  self.v2UserRequest = function v2UserRequest () {
    return buildV2Req('/user')
  }

  self.v2UserEmailsRequest = function v2UserEmailsRequest () {
    return buildV2Req('/user/emails')
  }

  self.v2TeamsByRoleRequest = function v2TeamsByRoleRequest (role) {
    // roles: admin, contributor, member
    return buildV2Req('/teams?role=' + role)
  }

  // request methods: privileges
  self.v1PrivilegesRequest = function v1PrivilegesRequest (accountname, repo, filter) {
    // filters: read, write, admin
    return buildV1Req('/privileges/' + accountname + '/' + repo + (filter ? '?filter=' + filter : ''))
  }

  self.v1RepoPrivilegesForUserRequest = function v1RepoPrivilegesForUserRequest (accountname, repo, username) {
    return buildV1Req('/privileges/' + accountname + '/' + repo + '/' + username)
  }

  // request methods: other users
  self.v2UsersRequest = function v2UsersRequest (username) {
    return buildV2Req('/users/' + username)
  }

  self.v2UsersFollowersRequest = function v2UsersFollowersRequest (username) {
    return buildV2Req('/users/' + username + '/followers')
  }

  self.v2UsersFollowingRequest = function v2UsersFollowingRequest (username) {
    return buildV2Req('/users/' + username + '/following')
  }

  self.v2RepositoriesRequest = function v2RepositoriesRequest (username) {
    return buildV2Req('/repositories/' + username)
  }

  // request methods: other teams
  self.v2TeamsRequest = function v2TeamsRequest (teamname) {
    return buildV2Req('/teams/' + teamname)
  }

  self.v2TeamsMembersRequest = function v2TeamsMembersRequest (teamname) {
    return buildV2Req('/teams/' + teamname + '/members')
  }

  self.v2TeamsRepositoriesRequest = function v2TeamsRepositoriesRequest (teamname) {
    return buildV2Req('/teams/' + teamname + '/repositories')
  }
}

function BitbucketRequest (url) {
  var self = this
  var _accessToken, _user, _pass

  self.accessToken = function accessToken (t) {
    if (t) _accessToken = t
    return self
  }

  self.username = function username (u) {
    if (u) _user = u
    return self
  }

  self.password = function password (p) {
    if (p) _pass = p
    return self
  }

  self.userPass = function userPass (u, p) {
    // accept two strings
    if (typeof u === 'string') return self.username(u).password(p)
    // or one object
    u = u || {}
    return self.username(u.username).password(u.password)
  }

  function buildGotOpts (method) {
    var opts = { json: true }
    if (method) opts.method = method
    if (_user && _pass) {
      opts.headers = {
        Authorization: 'Basic ' + new Buffer(_user + ':' + _pass).toString('base64')
      }
    }
    if (_accessToken) {
      opts.headers = {
        Authorization: 'Bearer ' + _accessToken
      }
    }
    return opts
  }

  // error returned will have props: statusCode, message, we_cause
  function wrapError (err, data, response) {
    if (!err) return null
    console.error('\napi wrapError data:', data, '\n')
    console.error('\napi wrapError err:', err, '\n')
    var resp = response || err.response || {}
    var statusCode = err.statusCode || resp.statusCode
    var message = (err.statusMessage || 'Error') + ' ' + (err.method || 'for') + ' ' + url
    if (data) {
      message = data.error_description
    } else if (resp.body && resp.body.error_description) {
      message = resp.body.error_description
    }
    var werror = new verror.WError(err, message)
    werror.statusCode = statusCode
    return werror
  }

  function execReq (method, cb) {
    var opts = buildGotOpts(method)
    if (typeof cb === 'function') {
      return got(url, opts, function (err, data, response) {
        cb(wrapError(err, data, response), data)
      })
    }
    return got(url, opts)
      .then(function (response) {
        return response.body
      })
      .catch(function (err) {
        throw wrapError(err)
      })
  }

  self.exec = function exec (cb) {
    return execReq(null, cb)
  }

  self.get = function get (cb) {
    return execReq('GET', cb)
  }

  self.post = function post (cb) {
    return execReq('POST', cb)
  }

  self.put = function put (cb) {
    return execReq('PUT', cb)
  }

  self.del = function del (cb) {
    return execReq('DELETE', cb)
  }
}

module.exports = BitbucketApi
