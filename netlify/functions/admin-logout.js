const { cookie, json } = require("./auth-utils");

exports.handler = async () => json(200, { ok: true }, { "Set-Cookie": cookie("", 0) });
