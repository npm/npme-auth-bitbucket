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
