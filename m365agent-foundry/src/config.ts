const config = {
  MicrosoftAppId: process.env.CLIENT_ID,
  MicrosoftAppType: process.env.BOT_TYPE,
  MicrosoftAppTenantId: process.env.TENANT_ID,
  MicrosoftAppPassword: process.env.CLIENT_SECRET,
  foundryAgentEndpoint: process.env.FOUNDRY_AGENT_ENDPOINT,
  foundryApiVersion: process.env.FOUNDRY_API_VERSION,
  foundryAppId: process.env.FOUNDRY_ENABLED_APP_ID,
  foundryAppSecret: process.env.FOUNDRY_ENABLED_APP_SECRET,
  foundryAppTenantId: process.env.FOUNDRY_ENABLED_APP_TENANT_ID || process.env.TENANT_ID,
};

export default config;
