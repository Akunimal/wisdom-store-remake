# Case Studies: Anti-Hallucination in Action

Real examples of wisdom-store-remake detecting issues introduced by AI coding assistants.

---

## Case 1: Hallucinated Import Path

**Scenario:** An AI assistant generated code importing from a file that doesn't exist.

```javascript
// AI-generated code:
import { processOrder } from '../services/order-processor.js';
```

**wisdom-store detection:**
```
❌ HALLUCINATION DETECTED
  Import path: ../services/order-processor.js
  Status: FILE NOT FOUND
  Suggestion: Did you mean ../services/orderService.js?
```

**Impact:** Without this check, the code would fail at runtime with a cryptic `MODULE_NOT_FOUND` error, potentially after deployment.

---

## Case 2: Typo in Function Name (Fuzzy Match)

**Scenario:** AI assistant called a function with a slight misspelling.

```javascript
// AI-generated code:
const catalog = useCatalg();  // typo: missing 'o'
```

**wisdom-store detection:**
```
⚠️ FUZZY MATCH (similarity: 0.89)
  Symbol: useCatalg
  Did you mean: useCatalog? (src/hooks/useCatalog.js:12)
  Status: POSSIBLE TYPO
```

**Impact:** Fuzzy matching catches typos that would compile in JavaScript but fail at runtime.

---

## Case 3: Unknown Symbol (Pure Hallucination)

**Scenario:** AI assistant called a function that was never defined anywhere in the project.

```javascript
// AI-generated code:
await validateUserPermissions(userId, 'admin');
```

**wisdom-store detection:**
```
❌ UNKNOWN SYMBOL
  Symbol: validateUserPermissions
  Status: NOT FOUND in project registry (0 matches)
  Action: Verify this function exists or run refresh_symbols if recently added
```

**Impact:** The AI invented a plausible-sounding function name. Without symbol checking, this would be discovered much later during testing.

---

## Case 4: Invalid API Route

**Scenario:** AI assistant referenced an API endpoint that doesn't exist.

```javascript
// AI-generated code:
const response = await fetch('/api/users/permissions');
```

**wisdom-store detection:**
```
❌ API ROUTE NOT FOUND
  Route: /api/users/permissions
  Known routes:
    GET  /api/users
    POST /api/users
    GET  /api/users/:id
  Suggestion: No similar route found — verify this endpoint exists
```

---

## How to Reproduce

1. Install wisdom-store-remake in your project:
   ```bash
   node /path/to/wisdom-store-remake/scripts/setup.js --project /your/project
   ```

2. Index your project:
   ```
   > reindex_project
   ```

3. Let your AI assistant write code, then:
   ```
   > check_symbols {"symbols": ["functionName1", "functionName2"]}
   ```

4. Or rely on the automatic post-write hook — it runs after every Write/Edit automatically.
