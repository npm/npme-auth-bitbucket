var defaultMsg = {
  500: 'unknown error',
  401: 'unauthorized',
  404: 'not found'
}

module.exports.forCode = function forCode (code, msg) {
  code = code || 500
  var error = Error(msg || defaultMsg[code])
  error.statusCode = code
  return error
}

// function callbackWithCode (cb, code, msg) {
//   process.nextTick(function () {
//     cb(forCode(code, msg))
//   })
// }

// module.exports = {
//   forCode: forCode,
//   callbackWithCode: callbackWithCode
// }

// module.exports = {
//   errorSync: function (code, msg) {
//     var error = Error(msg || 'unknown error')
//     error.statusCode = 500
//     return error
//   },
//   error500: function (msg) {
//     var error = Error(msg || 'unknown error')
//     error.statusCode = 500
//     return error
//   },
//   error401: function (msg) {
//     var error = Error(msg || 'unauthorized')
//     error.statusCode = 401
//     return error
//   },
//   error404: function (msg) {
//     var error = Error(msg || 'not found')
//     error.statusCode = 404
//     return error
//   }
// }
