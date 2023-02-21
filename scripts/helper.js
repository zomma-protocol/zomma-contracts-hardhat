const { buildIv, toDecimalStr, strFromDecimal } = require('../test/support/helper');

function nextFriday(date = new Date()) {
  let expiry = Math.floor(date.getTime() / 1000);
  expiry = expiry - expiry % 86400;
  const day = new Date(expiry * 1000).getDay();
  return expiry + (day >= 5 ? 12 - day : 5 - day) * 86400 + 3600 * 8;
}

module.exports = {
  buildIv,
  nextFriday,
  toDecimalStr,
  strFromDecimal
};
