
function is(it) {
	return !!it && it !== '0' && it !== 'false';
}
 
const env = process.env;

const ADBLOCK = is(env.ADBLOCK);
const SILENT = ['silent', 'error', 'warn'].includes(env.npm_config_loglevel) ;
const COLOR = is(env.npm_config_color);

const BANNER = `\u001B[96mThank you for using core-3nweb-client-lib (\u001B[94m https://github.com/3nsoft/core-3nweb-client-lib.git \u001B[96m) to power core of 3NWeb client side platform, like PrivacySafe, within which this library is developed\u001B[0m

\u001B[96mThe project needs your help! Please consider supporting PrivacySafe on Open Collective: \u001B[0m
\u001B[96m>\u001B[94m https://opencollective.com/privacysafe \u001B[0m
`;

function isBannerRequired() {
  if (ADBLOCK || SILENT) { return false; }
  return true;
}

if (isBannerRequired()) {
	console.log(COLOR ? BANNER : BANNER.replace(/\u001B\[\d+m/g, ''));
}
