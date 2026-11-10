# Orient in an installed app

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: None beyond an installed HeliumTS app.

Read the app's AGENTS.md first. For a known app method or route, use `npx helium inspect --rpc name --json` or `--route '/posts/:id' --json`. For an exact framework signature, use `npx helium api useCall --from client --json` or `npx helium api defineMethod --from server --json`. Discover unknown API names with `npx helium api --list --match fragment`.

Open one focused topic from node_modules/heliumts/docs/agent/index.md when you need a concept or example. Follow prerequisite links only to fill a gap; the full reference at node_modules/heliumts/docs/agent-guide.md is available for broader context.

Related: [Scaffold a minimal app](./scaffold.md), [Verify an application](./verify.md).
