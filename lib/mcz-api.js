const https = require("https");
const { URL } = require("url");
const BASE = "https://s.maestro.mcz.it";
const TENANT_ID = "7c201fd8-42bd-4333-914d-0f5822070757";

function request(method, path, body, token, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = { "content-type": "application/json", tenantid: TENANT_ID };
    if (token) headers["auth-token"] = token;
    if (payload) headers["content-length"] = Buffer.byteLength(payload);
    const req = https.request({hostname:url.hostname, port:443, path:url.pathname+url.search, method, headers, timeout}, res => {
      let data=""; res.setEncoding("utf8"); res.on("data", c => data += c);
      res.on("end", () => {
        let parsed=data; try { parsed=data ? JSON.parse(data) : null; } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const e=new Error(`MCZ HTTP ${res.statusCode} ${res.statusMessage || ""}`.trim()); e.statusCode=res.statusCode; e.body=parsed; reject(e);
      });
    });
    req.on("timeout", () => req.destroy(new Error("MCZ request timeout")));
    req.on("error", reject); if (payload) req.write(payload); req.end();
  });
}

class MczApi {
  constructor(username,password){this.username=username;this.password=password;this.token=null;}
  async login(){
    const r=await request("POST","/hlapi/v1.0/Authorization/Login",{username:this.username,password:this.password});
    if(!r || !r.Token) throw new Error("MCZ Login: kein Token erhalten"); this.token=r.Token;
  }
  async call(method,path,body){
    if(!this.token) await this.login();
    try{return await request(method,path,body,this.token);}catch(e){
      if(e.statusCode===401 || e.statusCode===403){this.token=null;await this.login();return request(method,path,body,this.token);} throw e;
    }
  }
  getDevices(){return this.call("POST","/hlapi/v1.0/Nav/FirstVisibleObjectsPaginated",{});}
  getModel(id){return this.call("GET",`/hlapi/v1.0/Model/${encodeURIComponent(id)}`);}
  getStatus(id){return this.call("GET",`/mcz/v1.0/Appliance/${encodeURIComponent(id)}/Status`);}
  getState(id){return this.call("GET",`/mcz/v1.0/Appliance/${encodeURIComponent(id)}/State`);}
  activateProgram(deviceId, modelId, configurationId, sensorSetTypeId, commands){
    return this.call("POST",`/mcz/v1.0/Program/ActivateProgram/${encodeURIComponent(deviceId)}`,{ModelId:modelId,ConfigurationId:configurationId,SensorSetTypeId:sensorSetTypeId,Commands:commands});
  }
}
module.exports={MczApi,BASE,TENANT_ID};
