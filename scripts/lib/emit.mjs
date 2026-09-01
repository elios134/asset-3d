export function makeEmitter(active, write = (s) => process.stdout.write(s)) {
  return (event) => { if (active) write(JSON.stringify(event) + "\n"); };
}
