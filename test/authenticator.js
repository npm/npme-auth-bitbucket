import test from 'ava'
import Authenticator from '../lib/authenticator'
import { MockRedisClient, MockOAuthApi, MockApi } from './_mocks'
import Session from '../lib/session'

test('_validateCredentials returns true for valid credentials object', t => {
  let creds = {
    body: {
      email: 'me@me.co',
      password: 'my really cool password'
    }
  }
  t.true(new Authenticator()._validateCredentials(creds))
})

test('_validateCredentials returns false when missing email', t => {
  let creds = {
    body: {
      name: 'username',
      password: 'my really cool password'
    }
  }
  t.false(new Authenticator()._validateCredentials(creds))
})

test('_validateCredentials returns false when missing password', t => {
  let creds = {
    body: {
      name: 'username',
      email: 'me@me.co',
      password: ''
    }
  }
  t.false(new Authenticator()._validateCredentials(creds))
})

test('_getSession returns null if precondition not met', async t => {
  return new Authenticator()._getSession().then(session => {
    t.is(session, null)
  })
})

test('_getSession returns session if precondition is met', async t => {
  return new Authenticator({ redisClient: new MockRedisClient() })._getSession(true).then(session => {
    t.ok(session)
  })
})

test('_getSession returns same session if called twice', async t => {
  let s
  let authenticator = new Authenticator({ redisClient: new MockRedisClient() })
  authenticator._getSession(true).then(session => {
    s = session
  })
  return authenticator._getSession(true).then(session => {
    t.same(session, s)
  })
})

test('_storeRefreshToken does not attempt to store without session', async t => {
  let authentication = {
    token: 'hello',
    refreshToken: 'world'
  }
  return new Authenticator()._storeRefreshToken(null, authentication).then(result => {
    t.is(result, null)
  })
})

test('_storeRefreshToken does not attempt to store without authentication', async t => {
  let session = new Session({ redisClient: new MockRedisClient() })
  return new Authenticator()._storeRefreshToken(session, null).then(result => {
    t.is(result, null)
  })
})

test('_storeRefreshToken stores refresh token with session and authentication', async t => {
  let session = new Session({ redisClient: new MockRedisClient('hello') })
  let authentication = {
    token: 'hello',
    refreshToken: 'world'
  }
  return new Authenticator()._storeRefreshToken(session, authentication).then(result => {
    t.is(result, 'OK')
  })
})

test('_dropRefreshToken attempts to delete refresh token', async t => {
  let session = new Session({ redisClient: new MockRedisClient() })
  return new Authenticator()._dropRefreshToken(session, 'token').then(result => {
    t.is(result, 1)
  })
})

test('_getAuthorizationToken returns valid structure', async t => {
  let oauthApi = new MockOAuthApi({ access_token: 'yo', refresh_token: 'wuddup' })
  let api = new MockApi({ username: 'fidget' })
  return new Authenticator({ oauthApi: oauthApi, api: api })._getAuthorizationToken({
    email: 'me@me.co',
    password: 'paddywagon',
    name: 'overwritten'
  }).then(auth => {
    t.same(auth, {
      token: 'yo',
      user: {
        name: 'fidget',
        email: 'me@me.co'
      },
      refreshToken: 'wuddup'
    })
  })
})

test('_getAuthorizationToken allows you to catch() an error', async t => {
  let oauthApi = new MockOAuthApi(new Error('problemos muchachos'))
  return new Authenticator({ oauthApi: oauthApi })._getAuthorizationToken().catch(err => {
    t.ok(err)
  })
})

test('authenticate rejects invalid credentials', async t => {
  new Authenticator().authenticate(null, err => {
    t.ok(err)
    t.is(err.statusCode, 500)
  })
})

test('authenticate calls oauth api, stores a refresh token, and returns npm-auth-ws structure', async t => {
  let redisClient = new MockRedisClient()
  return new Authenticator({
    redisClient: redisClient,
    oauthApi: new MockOAuthApi({ access_token: 'hola', refresh_token: 'mundo' }),
    api: new MockApi({ username: 'fundip' })
  }).authenticate({
    body: {
      name: 'blahblah',
      password: 'sugary',
      email: 'flippers@co.co'
    }
  }, (err, authentication) => {
    t.notOk(err)
    t.ok(authentication)
    t.is(authentication.token, 'hola')
    t.is(authentication.refreshToken, 'mundo')
    t.is(authentication.user.name, 'fundip')
    t.is(authentication.user.email, 'flippers@co.co')
    t.is(redisClient.setKey, 'refresh-hola')
    t.is(redisClient.setValue, 'mundo')
  })
})

test('unauthenticate attempts to delete refresh token', async t => {
  let redisClient = new MockRedisClient()
  return new Authenticator({
    redisClient: redisClient
  }).unauthenticate('toe-kin', (err) => {
    t.notOk(err)
    t.is(redisClient.delKey, 'refresh-toe-kin')
  })
})

test('unauthenticate swallows errors', async t => {
  let redisClient = new MockRedisClient()
  redisClient.del = function (key, cb) {
    process.nextTick(function () {
      cb(new Error('this should be logged and ignored'))
    })
  }
  return new Authenticator({
    redisClient: redisClient
  }).unauthenticate('detonate', (err) => {
    t.notOk(err)
  })
})
