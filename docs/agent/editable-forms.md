# Edit fetched data without a synchronization effect

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Call a validated method from a page](./validation-page.md), [Mutate and invalidate data](./mutations.md)

Pass a loaded article into this component. The app must already define getArticle({ id }), listArticles() and saveArticle({ id, title }) with server-side validation and authorization. The detail parent should show its loading, error and not-found states before rendering the editor.

```tsx file=src/components/ArticleEditor.tsx
import { useState, type FormEvent } from "react";
import { useCall } from "heliumts/client";
import { getArticle, listArticles, saveArticle } from "../rpc.generated";

type Article = { id: string; title: string };

export default function ArticleEditor({ article }: { article: Article }) {
    const save = useCall(saveArticle, { invalidate: [getArticle, listArticles] });
    const [draft, setDraft] = useState<Article | null>(null);
    const title = draft?.id === article.id ? draft.title : article.title;

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const outcome = await save.submit({ id: article.id, title });
        if (outcome.status === "success") setDraft(null);
    }

    return <form onSubmit={submit}>
        <label>Title <input value={title} onChange={(event) => setDraft({ id: article.id, title: event.currentTarget.value })} disabled={save.isCalling} required /></label>
        {save.error && <p role="alert">{save.error}</p>}
        <button type="submit" disabled={save.isCalling}>Save</button>
    </form>;
}
```

The displayed title comes from the current record until the user edits it. A draft is scoped to its record ID, so changing records does not display the previous record's draft. This avoids copying fetched data into state in a useEffect. Clear the draft only after a successful save; retain it when saving fails. The two invalidations refresh both the detail and its list.

Related: [Read and cache data](./operations.md).
