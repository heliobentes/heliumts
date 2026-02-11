# Data Fetching

HeliumTS provides two React hooks for data fetching and mutations: `useFetch` and `useCall`. Both hooks communicate with the server over WebSocket RPC, providing real-time, type-safe data operations.

## Public errors in production

In production, server errors are redacted to a generic "Server error" message by default.
If you want to expose a safe message to clients, throw a `PublicError` or an error-like
object with `{ public: true }` from your RPC method.

```ts
import { defineMethod, PublicError } from "heliumts/server";

export const createTask = defineMethod(async (args) => {
    if (!args.name?.trim()) {
        throw new PublicError("Task name is required");
        // Or: throw { public: true, message: "Task name is required" };
    }

    return createTaskInDb(args);
});
```

## useFetch

The `useFetch` hook automatically fetches data from a server method and caches the result. It's designed for **reading/querying data**.

### Basic Usage

```tsx
import { useFetch } from "heliumts/client";
import { getTasks } from "heliumts/server";

function TaskList() {
    const { data, isLoading, error } = useFetch(getTasks, { status: "open" });

    if (isLoading) return <div>Loading...</div>;
    if (error) return <div>Error: {error}</div>;

    return (
        <ul>
            {data?.map((task) => (
                <li key={task.id}>{task.name}</li>
            ))}
        </ul>
    );
}
```

### Return Values

| Property    | Type                                                      | Description                                                 |
| ----------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| `data`      | `TResult \| undefined`                                    | The fetched data (typed based on server method return type) |
| `isLoading` | `boolean`                                                 | Whether a fetch is in progress                              |
| `error`     | `string \| null`                                          | Error message if the fetch failed                           |
| `stats`     | `RpcStats \| null`                                        | RPC statistics (timing, etc.)                               |
| `refetch`   | `(showLoader?: boolean) => Promise<TResult \| undefined>` | Function to manually trigger a refetch                      |

### Options

The `useFetch` hook accepts an optional third parameter for controlling caching and refetch behavior:

```tsx
const { data, isLoading } = useFetch(method, args, {
    ttl: 30000,
    refetchOnWindowFocus: true,
    showLoaderOnRefocus: false,
    showLoaderOnInvalidate: false,
    enabled: true,
});
```

| Option                 | Type      | Default          | Description                                                                                                                                     |
| ---------------------- | --------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ttl`                  | `number`  | `300000` (5 min) | Time-to-live for cached data in milliseconds. After TTL expires, data is automatically refetched.                                               |
| `refetchOnWindowFocus` | `boolean` | `true`           | Automatically refetch when the browser tab becomes visible or window regains focus.                                                             |
| `showLoaderOnRefocus`  | `boolean` | `false`          | Whether to show loading state during focus-triggered refetches. When `false`, data updates silently in the background without showing a loader. |
| `showLoaderOnInvalidate` | `boolean` | `false`        | Whether to show loading state during refetches triggered by cache invalidation. When `false`, data updates silently in the background.          |
| `enabled`              | `boolean` | `true`           | Set to `false` to disable automatic fetching. Useful for conditional fetching when a required value isn't available yet.                        |

### Examples

#### Conditional Fetching

Only fetch when a required value is available:

```tsx
function UserProfile({ userId }: { userId?: string }) {
    const { data: user } = useFetch(
        getUser,
        { id: userId! },
        {
            enabled: !!userId, // Only fetch when userId exists
        }
    );

    if (!userId) return <div>Select a user</div>;
    return <div>{user?.name}</div>;
}
```

#### Custom Cache TTL

Set a shorter cache duration for frequently changing data:

```tsx
const { data: notifications } = useFetch(getNotifications, undefined, {
    ttl: 10000, // Refresh every 10 seconds
});
```

#### Silent Background Refetch (Default)

By default, when the user returns to the tab, data refetches silently without showing a loader:

```tsx
// Data updates in the background when tab regains focus
// No loading spinner shown - seamless UX
const { data, isLoading } = useFetch(getPosts);
```

#### Show Loader on Refocus

If you want to show a loading indicator when refetching on focus:

```tsx
const { data, isLoading } = useFetch(getPosts, undefined, {
    showLoaderOnRefocus: true, // Show loader when refetching on tab focus
});

#### Show Loader on Invalidate

If you want invalidation-triggered refetches to show a loading indicator:

```tsx
const { data, isLoading } = useFetch(getPosts, undefined, {
    showLoaderOnInvalidate: true, // Show loader when refetching after invalidation
});
```
```

#### Disable Refetch on Window Focus

For data that doesn't need to be fresh on every tab switch:

```tsx
const { data: settings } = useFetch(getUserSettings, undefined, {
    refetchOnWindowFocus: false, // Don't refetch when tab becomes visible
});
```

#### Manual Refetch

Trigger a refetch programmatically:

```tsx
function DataWithRefresh() {
    const { data, refetch, isLoading } = useFetch(getData);

    return (
        <div>
            <button onClick={() => refetch()} disabled={isLoading}>
                Refresh
            </button>
            <pre>{JSON.stringify(data, null, 2)}</pre>
        </div>
    );
}
```

You can also control whether the loader is shown during manual refetch:

```tsx
// Silent refetch (no loader)
await refetch(false);

// Refetch with loader (default)
await refetch(true);
```

---

## useCall

The `useCall` hook is used for **mutations** (create, update, delete operations). Unlike `useFetch`, it doesn't automatically execute — you call it manually when needed.

### Basic Usage

```tsx
import { useCall } from "heliumts/client";
import { createTask } from "heliumts/server";

function CreateTaskForm() {
    const { call, isCalling, error } = useCall(createTask);

    const handleSubmit = async (name: string) => {
        const result = await call({ name });
        if (result) {
            console.log("Task created:", result);
        }
    };

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                handleSubmit(e.target.taskName.value);
            }}
        >
            <input name="taskName" placeholder="Task name" />
            <button type="submit" disabled={isCalling}>
                {isCalling ? "Creating..." : "Create Task"}
            </button>
            {error && <p className="error">{error}</p>}
        </form>
    );
}
```

### Return Values

| Property    | Type                                             | Description                           |
| ----------- | ------------------------------------------------ | ------------------------------------- |
| `call`      | `(args: TArgs) => Promise<TResult \| undefined>` | Function to execute the server method |
| `isCalling` | `boolean`                                        | Whether a call is in progress         |
| `error`     | `string \| null`                                 | Error message if the call failed      |
| `stats`     | `RpcStats \| null`                               | RPC statistics (timing, etc.)         |

### Options

```tsx
const { call } = useCall(method, {
    invalidate: [getTasks, getTaskCount],
    onSuccess: (result) => console.log("Success:", result),
    onError: (error) => console.error("Error:", error),
});
```

| Option       | Type                        | Description                                                                                                                                                     |
| ------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalidate` | `MethodStub[]`              | Array of methods whose cached data should be invalidated after a successful call. This triggers automatic refetch for all `useFetch` hooks using those methods. |
| `onSuccess`  | `(result: TResult) => void` | Callback fired after a successful call                                                                                                                          |
| `onError`    | `(error: string) => void`   | Callback fired when the call fails                                                                                                                              |

### Examples

#### Cache Invalidation

Automatically refresh related data after a mutation:

```tsx
import { useCall, useFetch } from "heliumts/client";
import { getTasks, createTask, deleteTask } from "heliumts/server";

function TaskManager() {
    const { data: tasks } = useFetch(getTasks);

    const { call: addTask } = useCall(createTask, {
        invalidate: [getTasks], // Refetch getTasks after success
    });

    const { call: removeTask } = useCall(deleteTask, {
        invalidate: [getTasks],
    });

    return (
        <div>
            <button onClick={() => addTask({ name: "New Task" })}>Add Task</button>
            {tasks?.map((task) => (
                <div key={task.id}>
                    {task.name}
                    <button onClick={() => removeTask({ id: task.id })}>Delete</button>
                </div>
            ))}
        </div>
    );
}
```

#### With Callbacks

Handle success and error states:

```tsx
const { call } = useCall(updateUser, {
    onSuccess: (user) => {
        toast.success(`User ${user.name} updated!`);
        router.push("/users");
    },
    onError: (error) => {
        toast.error(`Failed to update: ${error}`);
    },
});
```

#### Optimistic Updates

For instant UI feedback, combine with local state:

```tsx
function LikeButton({ postId, initialLikes }: { postId: string; initialLikes: number }) {
    const [likes, setLikes] = useState(initialLikes);

    const { call: likePost } = useCall(addLike, {
        onError: () => setLikes(likes), // Revert on error
    });

    const handleLike = () => {
        setLikes(likes + 1); // Optimistic update
        likePost({ postId });
    };

    return <button onClick={handleLike}>❤️ {likes}</button>;
}
```

---

## Best Practices

### When to Use Which Hook

| Use Case                   | Hook                      |
| -------------------------- | ------------------------- |
| Fetching data on page load | `useFetch`                |
| Displaying a list of items | `useFetch`                |
| Creating a new record      | `useCall`                 |
| Updating existing data     | `useCall`                 |
| Deleting records           | `useCall`                 |
| Search with user input     | `useFetch` with `enabled` |
| Form submissions           | `useCall`                 |
| Sending an email           | `useCall`                 |

### Error Handling

Both hooks provide error states. Always handle errors gracefully:

```tsx
function MyComponent() {
    const { data, error, isLoading } = useFetch(getData);

    if (error) {
        return (
            <div className="error">
                <p>Something went wrong: {error}</p>
                <button onClick={() => window.location.reload()}>Retry</button>
            </div>
        );
    }

    // ... rest of component
}
```

### Loading States

Provide feedback during loading:

```tsx
function DataDisplay() {
    const { data, isLoading } = useFetch(getData);

    return (
        <div>
            {isLoading ? (
                <Skeleton /> // Show placeholder
            ) : (
                <Content data={data} />
            )}
        </div>
    );
}
```

### Type Safety

Both hooks are fully typed based on your server method definitions:

```tsx
// Server
export const getUser = defineMethod(async (args: { id: string }) => {
    return { id: args.id, name: "John", email: "john@example.com" };
});

// Client - types are inferred automatically
const { data } = useFetch(getUser, { id: "123" });
// data is typed as { id: string; name: string; email: string } | undefined
```
