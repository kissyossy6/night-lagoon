/** Same as vite.config.ts, but on :5200 and with no file watching / reload, so writing files
 *  (screenshots, notes) during a scenario run never reloads the page being tested. */
import { mergeConfig } from 'vite';
import base from '../../vite.config';
export default mergeConfig(base, { server: { port: 5200, strictPort: true, hmr: false, watch: { ignored: ['**'] } } });
