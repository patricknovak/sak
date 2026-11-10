// hls.js's light build (src/components/LiveWatch.tsx) ships without its own types; it is the full player's API
declare module 'hls.js/light' {
  export { default } from 'hls.js';
}
