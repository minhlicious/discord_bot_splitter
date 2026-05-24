const https = require('https');

function fetchPublishDate(name, version) {
  return new Promise((resolve, reject) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(new Date(json.time || json._time || 0));
        } catch {
          resolve(new Date(0));
        }
      });
    }).on('error', () => resolve(new Date(0)));
  });
}

module.exports = {
  hooks: {
    async readPackage(pkg, context) {
      const MIN_AGE_DAYS = 5;
      const now = Date.now();

      for (const [name, versionRange] of Object.entries({
        ...pkg.dependencies,
        ...pkg.devDependencies,
      })) {
        const version = versionRange.replace(/^[\^~>=<]/, '');
        if (!version || version.includes('*')) continue;

        try {
          const published = await fetchPublishDate(name, version);
          const ageMs = now - published.getTime();
          const ageDays = ageMs / (1000 * 60 * 60 * 24);

          if (ageDays < MIN_AGE_DAYS) {
            throw new Error(
              `[security] Package "${name}@${version}" was published ${ageDays.toFixed(1)} days ago — ` +
              `must be at least ${MIN_AGE_DAYS} days old. ` +
              `If intentional, wait until ${new Date(published.getTime() + MIN_AGE_DAYS * 86400000).toDateString()} to install.`
            );
          }
        } catch (err) {
          if (err.message.startsWith('[security]')) throw err;
          context.log(`[warn] Could not verify age of ${name}@${version}: ${err.message}`);
        }
      }

      return pkg;
    }
  }
};
