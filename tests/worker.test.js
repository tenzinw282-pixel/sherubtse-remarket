const {test}=require('node:test');
const assert=require('node:assert/strict');
const {startJobs}=require('../jobs/marketplace');
test('reconciliation does not overlap and shutdown drains in-flight work',async()=>{
  let release,calls=0,drained=false;
  const barrier=new Promise(resolve=>{release=resolve;});
  const client={query:async()=>({rows:[]}),release(){}};
  const jobs=startJobs({pool:{connect:async()=>client},commerce:{closeDue:async()=>{calls++;await barrier;}}});
  const overlapping=jobs.tick();const stopping=jobs.stop().then(()=>{drained=true;});
  await Promise.resolve();assert.equal(drained,false);assert.equal(calls,1);
  release();await stopping;await overlapping;assert.equal(drained,true);
  await jobs.tick();assert.equal(calls,1);
});
