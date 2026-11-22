# Overview of the Basic AI Chatbot template

This app template is built on top of [Microsoft Teams SDK](https://aka.ms/teams-ai-library-v2).
It showcases an agent app that responds to user questions like ChatGPT. This enables your users to talk with the AI agent in Teams.

## Get started with the template

> **Prerequisites**
>
> To run the template in your local dev machine, you will need:
>
> - [Node.js](https://nodejs.org/), supported versions: 22.
> - [Microsoft 365 Agents Toolkit Visual Studio Code Extension](https://aka.ms/teams-toolkit) latest version or [Microsoft 365 Agents Toolkit CLI](https://aka.ms/teamsfx-toolkit-cli).
> - Prepare a Microsoft Foundry agent and its Responses API endpoint.

> For local debugging using Microsoft 365 Agents Toolkit CLI, you need to do some extra steps described in [Set up your Microsoft 365 Agents Toolkit CLI for local debugging](https://aka.ms/teamsfx-cli-debugging).

1. First, select the Microsoft 365 Agents Toolkit icon on the left in the VS Code toolbar.
1. In file *env/.env.playground.user*, configure `FOUNDRY_AGENT_ENDPOINT` and `FOUNDRY_API_VERSION` for your Foundry agent.
1. Run `az login` if you want to fall back to your own user (only when `FOUNDRY_ENABLED_APP_ID` is not set). Authentication uses Entra ID, not an API key.
1. Press F5 to start debugging which launches your app in Microsoft 365 Agents Playground using a web browser. Select `Debug in Microsoft 365 Agents Playground`.
1. You can send any message to get a response from the agent.

**Congratulations**! You are running an application that can now interact with users in Microsoft 365 Agents Playground:

![Basic AI Chatbot](https://github.com/user-attachments/assets/984af126-222b-4c98-9578-0744790b103a)

## What's included in the template

### Direct Foundry Agent Responses API calls

[src/app/foundry-responses.ts](./src/app/foundry-responses.ts) uses `fetch()` from the existing `undici` dependency to POST
`{"input": [...], "stream": ...}` to `{FOUNDRY_AGENT_ENDPOINT}?api-version={FOUNDRY_API_VERSION}`.
The Foundry agent carries its own instructions, so only the conversation history is sent.

Personal chats request `stream: true` and forward `response.output_text.delta` SSE events to Teams as they arrive.
Group chats request a complete JSON response and send it once. Successful turns are saved in local, in-memory storage.
HTTP errors, invalid responses, `response.failed` events and streams interrupted before `response.completed`
reach the app's existing error handler. Requests have a ten-minute timeout and do not automatically retry.
The HTTP client limits TLS negotiation to TLS 1.2 because Node's default TLS handshake produces
`ECONNRESET` on the current network. Certificate validation remains enabled; no global TLS settings are changed.

The bearer token (scope `https://ai.azure.com/.default`) is chosen as follows:

1. If `FOUNDRY_ENABLED_APP_ID` is set, an app-token is requested with `ClientSecretCredential` using
   `FOUNDRY_ENABLED_APP_ID`, `FOUNDRY_ENABLED_APP_SECRET` (in `env/.env.*.user`, git-ignored) and
   `FOUNDRY_ENABLED_APP_TENANT_ID`. This is the local-test path.
2. Otherwise, with `RUNNING_ON_AZURE=1` (Azure), the user-assigned managed identity specified by `CLIENT_ID` is used.
   It needs access to the Foundry project.
3. Otherwise, `AzureCliCredential` (`az login`).

Teams authentication and message delivery still use the Teams SDK.

Run `npm test` for local HTTP tests (no Azure credentials needed), and `npm run build` to compile.

| Folder       | Contents                                            |
| - | - |
| `.vscode`    | VSCode files for debugging                          |
| `appPackage` | Templates for the application manifest        |
| `env`        | Environment files                                   |
| `infra`      | Templates for provisioning Azure resources          |
| `src`        | The source code for the application                 |

The following files can be customized and demonstrate an example implementation to get you started.

| File                                 | Contents                                           |
| - | - |
|`src/index.ts`| Application entry point. |
|`src/config.ts`| Defines the environment variables.|
|`src/app/instructions.txt`| Defines the prompt.|
|`src/app/app.ts`| Handles business logics for the Basic AI Chatbot.|

The following are Microsoft 365 Agents Toolkit specific project files. You can [visit a complete guide on Github](https://github.com/OfficeDev/TeamsFx/wiki/Teams-Toolkit-Visual-Studio-Code-v5-Guide#overview) to understand how Microsoft 365 Agents Toolkit works.

| File                                 | Contents                                           |
| - | - |
|`m365agents.yml`|This is the main Microsoft 365 Agents Toolkit project file. The project file defines two primary things:  Properties and configuration Stage definitions. |
|`m365agents.local.yml`|This overrides `m365agents.yml` with actions that enable local execution and debugging.|
|`m365agents.playground.yml`| This overrides `m365agents.yml` with actions that enable local execution and debugging in Microsoft 365 Agents Playground.|

## Extend the template

To extend the Basic AI Chatbot template with more AI capabilities, explore [Microsoft Teams SDK documentation](https://aka.ms/m365-agents-toolkit/teams-agent-extend-ai).

## Additional information and references

- [Microsoft 365 Agents Toolkit Documentations](https://docs.microsoft.com/microsoftteams/platform/toolkit/teams-toolkit-fundamentals)
- [Microsoft 365 Agents Toolkit CLI](https://aka.ms/teamsfx-toolkit-cli)
- [Microsoft 365 Agents Toolkit Samples](https://github.com/OfficeDev/TeamsFx-Samples)
