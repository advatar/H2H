// Strict ACLs: one workspace, allowlisted public non-shared channels, current membership.
export function pilotConfiguration(env=process.env) {
  const teamId=String(env.SLACK_TEAM_ID||"").trim();
  const allowedChannels=new Set(String(env.SLACK_ALLOWED_CHANNEL_IDS||"").split(",").map(x=>x.trim()).filter(Boolean));
  if(!/^T[A-Z0-9]+$/.test(teamId)||!allowedChannels.size||[...allowedChannels].some(c=>!/^C[A-Z0-9]+$/.test(c))) {
    throw new Error("Set SLACK_TEAM_ID and SLACK_ALLOWED_CHANNEL_IDS for this public-channel-only pilot");
  }
  return {teamId,allowedChannels};
}
export async function verifyPublicChannelMember(client,{teamId,channelId,userId,config}) {
  if(!config||teamId!==config.teamId||!config.allowedChannels.has(channelId)||
    !/^C[A-Z0-9]+$/.test(channelId)||!/^[UW][A-Z0-9]+$/.test(userId)) return false;
  try {
    const auth=await client.auth.test();
    if(auth?.ok===false||auth?.team_id!==teamId||!auth?.user_id) return false;
    const info=await client.conversations.info({channel:channelId});
    const c=info?.channel;
    if(info?.ok===false||!c||c.id!==channelId||c.is_channel!==true||
      c.is_private!==false||c.is_ext_shared!==false||c.is_archived===true||
      c.is_shared===true||c.is_org_shared===true||c.is_member!==true) return false;
    if(c.context_team_id&&c.context_team_id!==teamId) return false;
    const found=new Set();
    let cursor;
    for(let i=0;i<30;i++) {
      const page=await client.conversations.members({channel:channelId,limit:1000,...(cursor?{cursor}:{})});
      if(page?.ok===false||!Array.isArray(page?.members)) return false;
      for(const id of page.members) if(id===userId||id===auth.user_id) found.add(id);
      if(found.has(userId)&&found.has(auth.user_id)) return true;
      cursor=page.response_metadata?.next_cursor;
      if(!cursor) return false;
    }
    return false;
  }catch{return false;}
}
