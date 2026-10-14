import {startMcpServer} from "./server.js";
const running=await startMcpServer();
console.log("H2H MCP resource server listening on configured port (OAuth required)");
let exiting=false;
async function stop(){
  if(exiting)return;exiting=true;
  try{await running.stop();}finally{process.exitCode=0;}
}
process.once("SIGTERM",()=>void stop());
process.once("SIGINT",()=>void stop());
