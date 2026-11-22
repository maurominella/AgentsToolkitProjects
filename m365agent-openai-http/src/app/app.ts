import { App } from "@microsoft/teams.apps";
import { LocalStorage } from "@microsoft/teams.common";
import { MessageActivityInput, TokenCredentials } from '@microsoft/teams.api';
import { ManagedIdentityCredential, AzureCliCredential, getBearerTokenProvider } from '@azure/identity';

import * as fs from 'fs';
import * as path from 'path';
import config from "../config";
import { ChatMessage, sendChatCompletion } from "./openai-http";

// On Azure use the bot's User-Assigned MI, locally use the az login user
const azureOpenAICredential = process.env.RUNNING_ON_AZURE === '1'
  ? new ManagedIdentityCredential({ clientId: process.env.CLIENT_ID })
  : new AzureCliCredential();

const azureADTokenProvider = getBearerTokenProvider(
  azureOpenAICredential,
  "https://cognitiveservices.azure.com/.default"
);

// Create storage for conversation history
const storage = new LocalStorage<ChatMessage[]>();

// Load instructions from file on initialization
function loadInstructions(): string {
  const instructionsFilePath = path.join(__dirname, "instructions.txt");
  return fs.readFileSync(instructionsFilePath, 'utf-8').trim();
}

// Load instructions once at startup
const instructions = loadInstructions();

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
    const endpoint = config.azureOpenAIEndpoint;
    const deployment = config.azureOpenAIDeploymentName;
    if (!endpoint || !deployment) {
      throw new Error("AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT_NAME are required.");
    }

    const userMessage: ChatMessage = { role: "user", content: activity.text.trim() };
    const request = {
      endpoint,
      deployment,
      accessToken: await azureADTokenProvider(),
      messages: [
        ...(instructions ? [{ role: "system" as const, content: instructions }] : []),
        ...messages,
        userMessage,
      ],
    };
    let content: string;

    if (activity.conversation.isGroup) {
      // If the conversation is a group chat, we need to send the final response
      // back to the group chat
      content = await sendChatCompletion(request);
      const responseActivity = new MessageActivityInput(content).addAiGenerated().addFeedback();
      await send(responseActivity);
    } else {
      content = await sendChatCompletion({
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