var defaultMsg = {
  500: 'Unknown error',
  401: 'Unauthorized',
  404: 'Not found'
}

module.exports.forCode = function forCode (code, msg) {
  code = code || 500
  var error = Error(msg || defaultMsg[code])
  error.statusCode = code
  return error
}
