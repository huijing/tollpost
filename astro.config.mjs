// @ts-check

import mdx from '@astrojs/mdx';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import { SITE_URL } from './src/consts';

// https://astro.build/config
export default defineConfig({
	site: SITE_URL,
	integrations: [mdx(), sitemap()],
	adapter: node({ mode: 'standalone' }),
});
