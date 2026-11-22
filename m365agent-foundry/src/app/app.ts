import { App } from "@microsoft/teams.apps";
import { LocalStorage } from "@microsoft/teams.common";
import { MessageActivityInput, TokenCredentials } from '@microsoft/teams.api';
import { ManagedIdentityCredential, AzureCliCredential, ClientSecretCredential, TokenCredential, getBearerTokenProvider } from '@azure/identity';

import config from "../config";
import { ChatMessage, sendResponse } from "./foundry-responses";

// With FOUNDRY_ENABLED_APP_ID (local runs) request an app-token for Foundry using the app's client secret.
// Without it, on Azure use the bot's User-Assigned MI, otherwise the az login user.
function createFoundryCredential(): TokenCredential {
  if (config.foundryAppId) {
    if (!config.foundryAppSecret || !config.foundryAppTenantId) {
      throw new Error("FOUNDRY_ENABLED_APP_SECRET and FOUNDRY_ENABLED_APP_TENANT_ID are required with FOUNDRY_ENABLED_APP_ID.");
    }
    return new ClientSecretCredential(config.foundryAppTenantId, config.foundryAppId, config.foundryAppSecret);
  }
  return process.env.RUNNING_ON_AZURE === '1'
    ? new ManagedIdentityCredential({ clientId: process.env.CLIENT_ID })
    : new AzureCliCredential();
}

const azureADTokenProvider = getBearerTokenProvider(
  createFoundryCredential(),
  "https://ai.azure.com/.default"
);

// Create storage for conversation history
const storage = new LocalStorage<ChatMessage[]>();

const createTokenFactory = () => {
  return async (scope: string | string[], tenantId?: string): Promise<string> => {
    const managedIdentityCredential = new ManagedIdentityCredential({
        clientId: process.env.CLIENT_ID
      });
    const scopes = Array.isArray(scope) ? scope : [scope];
    const tokenResponse = await managedIdentityCredential.getToken(scopes, {
      tenantId: tenantId
    });
   
    return tokenResponse.token;
  };
};

// Configure authentication using TokenCredentials
const tokenCredentials: TokenCredentials = {
  clientId: process.env.CLIENT_ID || '',
  token: createTokenFactory()
};

const credentialOptions = config.MicrosoftAppType === "UserAssignedMsi" ? { ...tokenCredentials } : undefined;

// Create the app with storage
const app = new App({
  ...credentialOptions,
  storage,
  skipAuth: !process.env.CLIENT_ID,
});

// Handle incoming messages
app.on('message', async ({ send, stream, activity }) => {
  //Get conversation history
  const conversationKey = `${activity.conversation.id}/${activity.from.id}`;
  const messages = storage.get(conversationKey) || [];

  try {
    const endpoint = config.foundryAgentEndpoint;
    const apiVersion = config.foundryApiVersion;
    if (!endpoint || !apiVersion) {
      throw new Error("FOUNDRY_AGENT_ENDPOINT and FOUNDRY_API_VERSION are required.");
    }

    const userMessage: ChatMessage = { role: "user", content: activity.text.trim() };
    // The Foundry agent carries its own instructions, so only the conversation is sent.
    const request = {
      endpoint,
      apiVersion,
      accessToken: await azureADTokenProvider(),
      messages: [...messages, userMessage],
    };
    let content: string;

    if (activity.conversation.isGroup) {
      // If the conversation is a group chat, we need to send the final response
      // back to the group chat
      content = await sendResponse(request);
      const responseActivity = new MessageActivityInput(content).addAiGenerated().addFeedback();
      await send(responseActivity);
    } else {
      content = await sendResponse({
        ...request,
        onChunk: (chunk) => {
          stream.emit(chunk);
        },
      });
      // We wrap the final response with an AI Generated indicator
      stream.emit(new MessageActivityInput().addAiGenerated().addFeedback());
    }
    storage.set(conversationKey, [...messages, userMessage, { role: "assistant", content }]);
  } catch (error) {
    console.error(error);
    await send("The agent encountered an error or bug.");
    await send("To continue to run this agent, please fix the agent source code.");
  }
});

app.on('message.submit.feedback', async ({ activity }) => {
  //add custom feedback process logic here
  console.log("Your feedback is " + JSON.stringify(activity.value));
})

export default app;