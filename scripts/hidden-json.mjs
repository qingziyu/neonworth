/** Single bounded JSON input, hidden on a TTY, never echoed or logged. */
export async function readHiddenJSON(label,maxBytes) {
  let text=await new Promise((accept,reject)=>{
    let input='',done=false;const terminal=process.stdin.isTTY,wasRaw=process.stdin.isRaw;
    const finish=error=>{if(done)return;done=true;clearTimeout(timer);process.stdin.removeListener('data',onData);process.stdin.removeListener('end',onEnd);process.stdin.removeListener('error',onError);for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.removeListener(signal,onSignal);if(terminal)process.stdin.setRawMode(!!wasRaw);process.stdin.pause();error?reject(error):accept(input);input='';};
    const onData=chunk=>{input+=chunk;if(input.includes('\u0003'))finish(new Error('Input cancelled.'));else if(Buffer.byteLength(input,'utf8')>maxBytes)finish(new Error('Input exceeds its bounded limit.'));else if(/[\r\n]/.test(input))finish();};
    const onEnd=()=>finish(),onError=()=>finish(new Error('Unable to read hidden input.')),onSignal=()=>finish(new Error('Input interrupted.'));
    const timer=setTimeout(()=>finish(new Error('Hidden input timed out.')),120000);
    if(terminal)process.stdin.setRawMode(true);process.stderr.write(label+' (input is hidden).\n');process.stdin.setEncoding('utf8');process.stdin.on('data',onData);process.stdin.once('end',onEnd);process.stdin.once('error',onError);for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,onSignal);process.stdin.resume();
  });
  try{return JSON.parse(text);}catch{throw new Error('Supply one newline-terminated JSON object on hidden stdin.');}finally{text='';}
}
