# Neonworth workflows

For ordinary ChatGPT use, open a conversation with the Sites and financial-source capabilities available to your account, then paste one prompt. Your financial source is assumed already connected and authorized; the workflow checks actual access before asking for connection work.

| Task | Copy this prompt |
| --- | --- |
| Create a private workspace, or resume its setup | [Start](start.md) |
| Bring an existing workspace up to date | [Refresh](refresh.md) |
| Install reviewed code without replacing financial data | [Upgrade](upgrade.md) |
| Resolve an interrupted operation | [Recovery](recovery.md) |

Replace the clearly marked Site/release/stage fields before sending. A prompt does not provide missing tools or credentials. If the financial plugin is installed but its tools are absent in the current conversation, use a supported ChatGPT Work conversation with the same plugin; that does not mean the bank needs reconnecting. The [Sites profile](../profiles/sites/README.md) and [finance harness](../integrations/gpt-finance/README.md) define what this release actually supports.

## Reusable agent package

The repository includes an instructions-only plugin, `neonworth-workflows`, and a repository catalog at `.agents/plugins/marketplace.json`. It bundles the [workflow skill](../skills/neonworth-workflows/SKILL.md) and existing [adapter-development skill](../skills/neonworth-integrations/SKILL.md). It installs no server, hooks, credentials or automatic update task. Sites and financial-source tools are separate capabilities.

The catalog uses the supported `ON_USE` authentication policy; there is no bundled service to connect. It must not start a new Finance connection flow. The plugin version comes from the root `plugin.json`, which the local catalog references directly.

After reviewing a checkout, a supported local Codex client can register that checkout as a marketplace using `codex plugin marketplace add /absolute/path/to/neonworth`. Open the plugin browser, select the Neonworth source and install Neonworth workflows. Start a new session to test discovery. Local marketplace availability varies by surface; this repository is not a claim of approval or listing in the universal public plugin directory. The copy-and-paste prompts remain usable without installing this package.

The manifest follows [OpenAI's portable plugin format](https://developers.openai.com/plugins/build/plugins), with skills in the root `skills/` directory. [Skill and plugin availability](https://learn.chatgpt.com/docs/build-skills) depends on the client and workspace. Installation is not authority to access accounts, create Sites, publish code or schedule jobs; the user's task and native approvals govern those actions.

Do not distribute a private instance checkout as this plugin. Use the public template release only: an instance's hosting manifest, runtime files, backups and operation receipt belong outside public packages. Verify a new installed copy with a synthetic task before using live tools. Source validation, successful installation, hosted deployment and a verified financial refresh are separate outcomes.
