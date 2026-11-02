import fs from 'node:fs/promises';import {Resvg} from '@resvg/resvg-js';
const svg=await fs.readFile(new URL('../assets/icon.svg',import.meta.url));await fs.writeFile(new URL('../assets/icon.png',import.meta.url),new Resvg(svg).render().asPng());
