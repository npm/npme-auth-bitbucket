var got = require('got')
var urlParser = require('url')
var verror = require('verror')

function BitbucketOAuth2Api (opts) {
  if (!(this instanceof BitbucketOAuth2Api)) return new BitbucketOAuth2Api(opts)

  var self = this
  var _protocol = 'https'
  var _host = 'bitbucket.org'
  var _port = ''
  var _endpointPrefix = '/site/oauth2'
  var _clientId, _clientSecret

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

  self.endpointPrefix = function endpointPrefix (ep) {
    if (typeof ep === 'string') _endpointPrefix = ep
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

  self.clientId = function clientId (id) {
    if (id) _clientId = id
    return self
  }

  self.clientSecret = function clientSecret (secret) {
    if (secret) _clientSecret = secret
    return self
  }

  self.client = function client (id, secret) {
    // accept two strings
    if (typeof id === 'string') return self.clientId(id).clientSecret(secret)
    // or one object
    id = id || {}
    return self.clientId(id.clientId).clientSecret(id.clientSecret)
  }

  // handle opts
  if (typeof opts === 'string') self.url(opts)
  else if (opts) {
    self
      .url(opts.url)
      .protocol(opts.protocol)
      .host(opts.host)
      .port(opts.port)
      .endpointPrefix(opts.endpointPrefix)
      .client(opts)
  }

  // private methods
  function buildUrl (endpoint) {
    return _protocol + '://' + _host + (_port ? ':' + _port : '') + _endpointPrefix + endpoint
  }

  // request methods
  self.accessTokenRequest = function accessTokenRequest () {
    return new BitbucketOAuth2Request(buildUrl('/access_token')).client(_clientId, _clientSecret)
  }
}

function BitbucketOAuth2Request (url) {
  var self = this
  var _clientId, _clientSecret, _username, _password, _refreshToken

  self.clientId = function clientId (id) {
    if (id) _clientId = id
    return self
  }

  self.clientSecret = function clientSecret (secret) {
    if (secret) _clientSecret = secret
    return self
  }

  self.client = function client (id, secret) {
    // accept two strings
    if (typeof id === 'string') return self.clientId(id).clientSecret(secret)
    // or one object
    id = id || {}
    return self.clientId(id.clientId).clientSecret(id.clientSecret)
  }

  self.username = function username (u) {
    if (u) _username = u
    return self
  }

  self.password = function password (p) {
    if (p) _password = p
    return self
  }

  self.userPass = function userPass (u, p) {
    // accept two strings
    if (typeof u === 'string') return self.username(u).password(p)
    // or one object
    u = u || {}
    return self.username(u.username).password(u.password)
  }

  self.refreshToken = function refreshToken (rt) {
    if (rt) _refreshToken = rt
    return self
  }

  function buildGotOpts () {
    var opts = { json: true }
    if (_clientId && _clientSecret) {
      opts.headers = {
        Authorization: 'Basic ' + new Buffer(_clientId + ':' + _clientSecret).toString('base64')
      }
    }
    if (_username && _password) {
      opts.method = 'POST'
      opts.body = {
        grant_type: 'password',
        username: _username,
        password: _password
      }
    }
    if (_refreshToken) {
      opts.method = 'POST'
      opts.body = {
        grant_type: 'refresh_token',
        refresh_token: _refreshToken
      }
    }
    return opts
  }

  // error returned will have props: statusCode, message, we_cause
  function wrapError (err, data, response) {
    if (!err) return null
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

  /*
  data structure {
    access_token: '',
    refresh_token: '',
    token_type: 'bearer',
    expires_in: 3600,
    scopes = 'project team account ...'
  }
  or error with props: statusCode, message, we_cause
  */
  self.exec = function exec (cb) {
    var opts = buildGotOpts()
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
}

module.exports = BitbucketOAuth2Api
