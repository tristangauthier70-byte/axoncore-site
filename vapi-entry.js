// Browser entry — exports Vapi class as window.Vapi
var Vapi = require('@vapi-ai/web');
window.Vapi = Vapi.default || Vapi;
