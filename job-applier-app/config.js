const path=require('path');
const dataDir=path.resolve(process.env.JOB_APPLIER_DATA_DIR||path.join(__dirname,'..','data'));
module.exports={dataDir};
