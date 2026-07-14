const esbuild = require('esbuild');
const watch = process.argv.includes('--watch');

const targets = [
  { entryPoints: ['src/content/content.ts'],       outfile: 'dist/content.js'    },
  { entryPoints: ['src/popup/popup.ts'],           outfile: 'dist/popup.js'      },
  { entryPoints: ['src/options/options.ts'],       outfile: 'dist/options.js'    },
  { entryPoints: ['src/background/background.ts'], outfile: 'dist/background.js' },
];

const base = {
  bundle: true,
  platform: 'browser',
  target: 'firefox78',
  sourcemap: true,
};

if (watch) {
  Promise.all(
    targets.map(async (t) => {
      const ctx = await esbuild.context({ ...base, ...t });
      await ctx.watch();
      console.log(`watching ${t.entryPoints[0]}`);
    })
  );
} else {
  Promise.all(targets.map((t) => esbuild.build({ ...base, ...t })))
    .then(() => console.log('build complete'))
    .catch(() => process.exit(1));
}
