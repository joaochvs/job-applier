const {getBrowser} = require('./browser');
(async()=>{
  const {context}=await getBrowser();
  const page=context.pages()[0]||await context.newPage();
  await page.goto('https://www.linkedin.com/login',{waitUntil:'domcontentloaded'});
  console.log('Faça login manualmente no navegador de candidaturas. Depois abra start.bat.');
  process.exit(0);
})().catch(error=>{console.error(error.message);process.exit(1)});
