import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import {buildApp} from './app.ts';

dotenv.config({path:resolve(process.cwd(),'.env')});

export {buildApp} from './app.ts';

const isEntrypoint=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const app=await buildApp({logger:true});
  try {
    await app.listen({port:Number(process.env.PORT||3000),host:'0.0.0.0'});
  } catch (error) {
    app.log.error(error);
    process.exitCode=1;
  }
}
