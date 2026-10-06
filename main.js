const utils = require("@iobroker/adapter-core");
const { MczApi } = require("./lib/mcz-api");

const COMMANDS = {
  power: { configurationId:"e373bb67-fe69-4d49-b2f2-4b636fa68e37", sensorId:"9c7f0959-47a2-44ea-906d-f5d22218d00e" },
  targetTemperature: { configurationId:"875fb696-4af1-42da-bb78-ebe57c90fe5c", sensorId:"b866d2a9-d0ab-4558-8367-910c52261be1" },
  powerLevel: { configurationId:"fa2e1c9e-83e3-4435-825b-cdfb50da92a7", sensorId:"f7750f3e-9ff2-4351-b53a-6d1a9d1f6bc6" },
  mode: { configurationId:"d85b93a4-4cae-4745-925d-ef53547c661e", sensorId:"bd064ae8-9091-4696-b137-5a4e243ebb91" },
  eco: { configurationId:"90118b92-96e5-4642-8644-3b69cbb498a5", sensorId:"8bdba486-00d0-4a3d-972f-3069a7d8f41e" }
};
const MODE_TO_VALUE={MANUAL:0,AUTO:1,OVERNIGHT:2,COMFORT:3,TURBO:4};
const VALUE_TO_MODE=Object.fromEntries(Object.entries(MODE_TO_VALUE).map(([k,v])=>[v,k]));

class MczMaestro extends utils.Adapter {
  constructor(options={}) {
    super({...options,name:"mcz-maestro"});
    this.api=null; this.device=null; this.model=null; this.timer=null; this.busy=false;
    this.on("ready",()=>this.onReady());
    this.on("stateChange",(id,state)=>this.onStateChange(id,state));
    this.on("unload",cb=>this.onUnload(cb));
  }

  safe(v){return String(v??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"_").replace(/^_+|_+$/g,"").slice(0,100)||"value";}
  infer(v){if(typeof v==="boolean")return "boolean";if(typeof v==="number"&&Number.isFinite(v))return "number";return "string";}
  cast(v,t){if(t==="boolean")return Boolean(v);if(t==="number"){const n=Number(v);return Number.isFinite(n)?n:0;}return v==null?"":String(v);}
  async channel(id,name){await this.extendObjectAsync(id,{type:"channel",common:{name},native:{}});}
  async stateObject(id,common,native={}){await this.extendObjectAsync(id,{type:"state",common:{read:true,write:false,...common},native});}
  async put(id,val,ack=true){await this.setStateAsync(id,{val,ack});}
  async createValue(id,name,val,{write=false,role,unit,states,min,max,native={}}={}){
    const type=this.infer(val);
    const isButton=role==="button";
    const common={name,type,role:role||(type==="boolean"?(write?"switch":"indicator"):(type==="number"?"value":"text")),read:!isButton,write};
    if(unit)common.unit=unit;if(states)common.states=states;if(Number.isFinite(min))common.min=min;if(Number.isFinite(max))common.max=max;
    await this.stateObject(id,common,native); if(val!==undefined)await this.put(id,this.cast(val,type),true);
  }

  async onReady(){
    await this.channel("info","Information"); await this.channel("connection","Verbindung");
    await this.createValue("info.connection","Verbunden",false,{role:"indicator.connected"});
    await this.createValue("connection.connected","Cloud verbunden",false,{role:"indicator.connected"});
    await this.createValue("connection.lastUpdate","Letzte Aktualisierung",0,{role:"value.time"});
    await this.createValue("connection.lastError","Letzter Fehler","",{role:"text"});
    if(!this.config.username||!this.config.password){this.log.error("MCZ Benutzername und Passwort fehlen");return;}
    this.api=new MczApi(this.config.username,this.config.password);
    try{
      await this.cleanupLegacyObjects();
      await this.initDevice();
      await this.refresh();
      const ms=Math.max(10,Number(this.config.pollInterval)||30)*1000;
      this.timer=setInterval(()=>this.refresh().catch(e=>this.log.warn(`Aktualisierung fehlgeschlagen: ${e.message}`)),ms);
    }catch(e){this.log.error(`MCZ Initialisierung fehlgeschlagen: ${e.message}`);await this.setConnection(false,e.message);}
  }

  async cleanupLegacyObjects(){
    // 0.2.0 created thousands of model.* objects. Remove the whole legacy tree once on every start;
    // 0.2.1 recreates only a compact model summary below model.*.
    try {
      const old=await this.getObjectAsync("model");
      if(old){
        this.log.info("Migration 0.2.1: entferne alten umfangreichen model.* Objektbaum ...");
        await this.delObjectAsync("model",{recursive:true});
        this.log.info("Migration 0.2.1: alter model.* Objektbaum entfernt");
      }
    } catch(e) { this.log.warn(`Migration: model.* konnte nicht vollstaendig entfernt werden: ${e.message}`); }
    // Remove obsolete ambiguous power states from 0.2.0. They are replaced by climate.isOn and buttons.
    for(const id of ["climate.power","commands.Power"]){
      try { if(await this.getObjectAsync(id)) await this.delObjectAsync(id); } catch(_) {}
    }
  }

  async initDevice(){
    const list=await this.api.getDevices(); if(!Array.isArray(list))throw new Error("MCZ API liefert keine Geraeteliste");
    const devices=list.filter(x=>x&&x.Node&&x.Node.UniqueCode); const wanted=String(this.config.deviceId||"").trim();
    const entry=wanted?devices.find(x=>x.Node.UniqueCode===wanted||x.Node.Id===wanted):devices[0]; if(!entry)throw new Error(`Geraet '${wanted}' nicht gefunden`); this.device=entry.Node;
    await this.createInfo(); await this.createClimate(); await this.createCommands();
    await this.channel("raw","MCZ Rohdaten"); await this.channel("raw.status","Status"); await this.channel("raw.state","State");
    this.model=await this.api.getModel(this.device.ModelId);
    await this.createCompactModel(this.model);
    this.subscribeStates("climate.*"); this.subscribeStates("commands.*");
    this.log.info(`MCZ-Geraet verbunden: ${this.device.Name} (${this.device.UniqueCode})`);
  }

  async createInfo(){
    const d=this.device; const vals={name:d.Name||"",uniqueCode:d.UniqueCode||"",deviceId:d.Id||"",modelId:d.ModelId||"",sensorSetTypeId:d.SensorSetTypeId||"",timezone:d.TimezoneIANA||"",location:d.Location||""};
    for(const [k,v] of Object.entries(vals))await this.createValue(`info.${k}`,k,v,{role:"text"});
  }

  async createClimate(){
    await this.channel("climate","Heizung");
    await this.createValue("climate.isOn","Ofen ist eingeschaltet",false,{role:"indicator"});
    await this.createValue("climate.targetTemperature","Solltemperatur",21,{write:true,role:"level.temperature",unit:"°C",min:5,max:40});
    await this.createValue("climate.currentTemperature","Raumtemperatur",0,{role:"value.temperature",unit:"°C"});
    await this.createValue("climate.powerLevel","Leistungsstufe",1,{write:true,role:"level",min:1,max:5});
    await this.createValue("climate.mode","Betriebsart","AUTO",{write:true,role:"level.mode",states:{MANUAL:"Manuell",AUTO:"Automatik",OVERNIGHT:"Nacht",COMFORT:"Komfort",TURBO:"Turbo"}});
    await this.createValue("climate.ecoMode","Eco/Sparmodus",false,{write:true,role:"switch"});
    await this.createValue("climate.fanLevel","Luefterstufe",0,{role:"value",min:-1,max:6});
    await this.createValue("climate.operatingState","Betriebszustand","",{role:"text"});
    await this.createValue("climate.flueTemperature","Abgastemperatur",0,{role:"value.temperature",unit:"°C"});
    await this.createValue("climate.lastAlarm","Letzter Alarm","",{role:"text"});
    await this.createValue("climate.error","Stoerung",false,{role:"indicator.maintenance"});
  }

  async createCommands(){
    await this.channel("commands","Kommandos");
    await this.createValue("commands.powerOn","Ofen einschalten",false,{write:true,role:"button"});
    await this.createValue("commands.powerOff","Ofen ausschalten",false,{write:true,role:"button"});
    await this.createValue("commands.refresh","Jetzt aktualisieren",false,{write:true,role:"button"});
    await this.createValue("commands.lastCommand","Letzter Befehl","",{role:"text"});
    await this.createValue("commands.lastResult","Letztes Ergebnis","",{role:"text"});
    await this.createValue("commands.lastError","Letzter Befehlsfehler","",{role:"text"});
    await this.createValue("commands.lastCommandTime","Zeit letzter Befehl",0,{role:"value.time"});
    await this.createValue("commands.lastPayload","Letzter API-Payload","",{role:"json"});
  }

  async createCompactModel(model){
    await this.channel("model","MCZ Modell");
    await this.createValue("model.name","Modellname",model?.ModelName||"",{role:"text"});
    await this.createValue("model.sensorCount","Anzahl Sensor-IDs",Array.isArray(model?.SensorIds)?model.SensorIds.length:0);
    await this.createValue("model.configurationCount","Anzahl Konfigurationen",Array.isArray(model?.ModelConfigurations)?model.ModelConfigurations.length:0);
    // Full model remains available without creating thousands of ioBroker objects.
    await this.createValue("model.sensorIdsJson","Alle Sensor-IDs (JSON)",JSON.stringify(model?.SensorIds||[]),{role:"json"});
    await this.createValue("model.configurationsJson","Alle Konfigurationen (JSON)",JSON.stringify(model?.ModelConfigurations||[]),{role:"json"});
  }

  async writeRaw(obj,base){
    if(!obj||typeof obj!=="object")return;
    for(const [k,v] of Object.entries(obj)){
      if(v===null||["string","number","boolean"].includes(typeof v)){
        const id=`${base}.${this.safe(k)}`; await this.createValue(id,k,v===null?"":v);
      }
    }
  }
  async setConnection(ok,error=""){await this.put("info.connection",ok);await this.put("connection.connected",ok);if(ok)await this.put("connection.lastUpdate",Date.now());await this.put("connection.lastError",error);}

  actualPowerState(status,state){
    // For this MCZ export power_enabled=true can coexist with fase_op/state="off".
    // Therefore only operational phase/state is used for the actual on/off indicator.
    const phase=status?.fase_op ?? state?.state ?? status?.Status;
    if(phase===undefined||phase===null)return false;
    const p=String(phase).trim().toLowerCase();
    return !["", "off", "unknown", "standby", "spento", "0"].includes(p);
  }

  async refresh(){
    if(!this.device||this.busy)return; this.busy=true;
    try{
      const [status,state]=await Promise.all([this.api.getStatus(this.device.Id),this.api.getState(this.device.Id)]);
      await this.writeRaw(status,"raw.status"); await this.writeRaw(state,"raw.state"); await this.syncClimate(status||{},state||{});
      await this.setConnection(status?.IsConnected!==false&&state?.IsConnected!==false,"");
    }catch(e){await this.setConnection(false,e.message);throw e;}finally{this.busy=false;}
  }

  async syncClimate(s,st){
    const pick=(...keys)=>{for(const k of keys)if(s[k]!==undefined)return s[k];for(const k of keys)if(st[k]!==undefined)return st[k];};
    const pairs=[
      ["climate.isOn",this.actualPowerState(s,st)],
      ["climate.targetTemperature",Number(pick("set_amb1")??0)],
      ["climate.currentTemperature",Number(pick("temp_amb_install","temp_amb1")??0)],
      ["climate.powerLevel",Number(pick("set_pot_man")??1)],
      ["climate.ecoMode",Boolean(pick("sav_m","att_eco"))],
      ["climate.fanLevel",typeof pick("set_vent_v1")==="number"?pick("set_vent_v1"):0],
      ["climate.operatingState",String(pick("fase_op","state","Status")??"")],
      ["climate.flueTemperature",Number(pick("temp_fumi")??0)],
      ["climate.lastAlarm",String(pick("last_alarm")??"")],
      ["climate.error",Boolean(pick("IsInError"))]
    ];
    const mv=pick("mod_funz"); if(mv!==undefined&&VALUE_TO_MODE[Number(mv)]!==undefined)pairs.push(["climate.mode",VALUE_TO_MODE[Number(mv)]]);
    for(const [id,v] of pairs)await this.put(id,v);
  }

  async sendCommand(name,definition,value){
    const started=Date.now();
    await this.put("commands.lastCommand",`${name}: ${value}`);
    await this.put("commands.lastCommandTime",started);
    await this.put("commands.lastResult","wird gesendet");
    await this.put("commands.lastError","");
    this.log.info(`MCZ ${name} angefordert: ${value}`);
    const payload={ModelId:this.device.ModelId,ConfigurationId:definition.configurationId,SensorSetTypeId:this.device.SensorSetTypeId,Commands:[{SensorId:definition.sensorId,Value:value}]};
    await this.put("commands.lastPayload",JSON.stringify(payload).slice(0,5000));
    if(this.config.debug)this.log.debug(`MCZ ActivateProgram payload=${JSON.stringify(payload)}`);
    try{
      const result=await this.api.activateProgram(this.device.Id,this.device.ModelId,definition.configurationId,this.device.SensorSetTypeId,[{SensorId:definition.sensorId,Value:value}]);
      const resultText=result==null?"OK":(typeof result==="string"?result:JSON.stringify(result));
      await this.put("commands.lastResult",resultText.slice(0,2000));
      this.log.info(`MCZ ${name} gesendet; API-Antwort: ${resultText.slice(0,500)}`);
      setTimeout(()=>this.refresh().catch(e=>this.log.warn(`Status nach Befehl konnte nicht gelesen werden: ${e.message}`)),3000);
      return result;
    }catch(e){
      const detail=e.body?` | ${typeof e.body==="string"?e.body:JSON.stringify(e.body)}`:"";
      const msg=`${e.message}${detail}`;
      await this.put("commands.lastResult","FEHLER"); await this.put("commands.lastError",msg.slice(0,2000)); await this.put("connection.lastError",msg.slice(0,2000));
      this.log.error(`MCZ ${name} fehlgeschlagen: ${msg}`); throw e;
    }
  }

  async onStateChange(id,state){
    if(!state||state.ack)return;
    if(!(id.startsWith(`${this.namespace}.climate.`)||id.startsWith(`${this.namespace}.commands.`)))return;
    const leaf=id.split(".").pop();
    try{
      if(leaf==="powerOn"){
        await this.sendCommand("POWER ON",COMMANDS.power,true); await this.put("commands.powerOn",false); return;
      }
      if(leaf==="powerOff"){
        // This stove exposes "Spegnimento" as a timed boolean command (com_on_off).
        // Tests on this exact device show false is accepted but is a no-op, while non-boolean 40 is rejected.
        // Treat the boolean as an action trigger: true executes the power command.
        // The actual result is determined from fase_op/state after the command.
        await this.sendCommand("POWER OFF",COMMANDS.power,true);
        await this.put("commands.powerOff",false);
        return;
      }
      if(leaf==="refresh"){
        this.log.info("MCZ manueller Refresh angefordert"); await this.refresh(); await this.put("commands.refresh",false); return;
      }
      let key=null,value=state.val;
      if(leaf==="targetTemperature"){key="targetTemperature";value=Number(value);if(!Number.isFinite(value)||value<5||value>40)throw new Error("Solltemperatur muss 5 bis 40 °C betragen");}
      else if(leaf==="powerLevel"){key="powerLevel";value=Number(value);if(!Number.isInteger(value)||value<1||value>5)throw new Error("Leistungsstufe muss 1 bis 5 sein");}
      else if(leaf==="mode"){key="mode";const m=String(value).toUpperCase();if(MODE_TO_VALUE[m]===undefined)throw new Error(`Unbekannte Betriebsart ${value}`);value=MODE_TO_VALUE[m];}
      else if(leaf==="ecoMode"){key="eco";value=Boolean(value);}
      else return;
      await this.sendCommand(key,COMMANDS[key],value);
      await this.put(id,state.val);
    }catch(e){
      if(leaf==="powerOn")await this.put("commands.powerOn",false).catch(()=>{});
      if(leaf==="powerOff")await this.put("commands.powerOff",false).catch(()=>{});
    }
  }

  onUnload(cb){try{if(this.timer)clearInterval(this.timer);cb();}catch(_){cb();}}
}

if(require.main!==module)module.exports=options=>new MczMaestro(options);else new MczMaestro();
