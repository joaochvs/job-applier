const fs=require('fs');const path=require('path');
function emit(stage,message,extra={}){
  const dir=path.join(__dirname,'runtime');fs.mkdirSync(dir,{recursive:true});
  fs.appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),stage,message,...extra})+'\n');
}
module.exports={emit};
