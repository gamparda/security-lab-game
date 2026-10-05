import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser',testMatch:['chrome-smoke.spec.js','game.spec.js'],
 workers:1,timeout:90000,retries:0,
 use:{baseURL:process.env.GAME_URL||'http://localhost:5173',trace:'retain-on-failure'},
 webServer:process.env.GAME_URL?undefined:{command:'python run.py',url:'http://localhost:5173',reuseExistingServer:!process.env.CI},
 projects:[{name:'windows-chrome',use:{
  browserName:'chromium',channel:'chrome',headless:false,viewport:{width:1920,height:1080},
  launchOptions:{args:process.env.CI?['--use-gl=angle','--use-angle=d3d11-warp']:['--enable-gpu','--use-angle=d3d11']}
 }}],
});
