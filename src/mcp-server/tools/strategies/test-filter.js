/**
 * Test runner output filter strategies
 * Inspired by RTK's Failure Focus strategy.
 *
 * Supports: npm test, jest, vitest, pytest, cargo test, go test
 * Strategy: Show only failures + summary, hide passing tests.
 */

/**
 * Generic test output compressor.
 * Extracts failures and summary from test runner output.
 */
export function filterTestOutput(output) {
  const lines = output.split('\n');
  if (!lines.length || !output.trim()) return { compressed: 'no output', savings: 100 };

  const failures = [];
  const errors = [];
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let skippedTests = 0;
  let inFailure = false;
  let currentFailure = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect summary lines (various formats)
    // Jest/Vitest: Tests: 2 failed, 18 passed, 20 total
    const jestSummary = trimmed.match(/Tests?:\s*(\d+)\s*failed.*?(\d+)\s*passed.*?(\d+)\s*total/i);
    if (jestSummary) {
      failedTests = parseInt(jestSummary[1]);
      passedTests = parseInt(jestSummary[2]);
      totalTests = parseInt(jestSummary[3]);
      continue;
    }

    // pytest: 18 passed, 2 failed
    const pytestSummary = trimmed.match(/(\d+)\s*passed.*?(\d+)\s*failed/i) ||
                          trimmed.match(/(\d+)\s*failed.*?(\d+)\s*passed/i);
    if (pytestSummary) {
      // Figure out which is which based on order
      if (trimmed.match(/(\d+)\s*passed/)) passedTests = parseInt(trimmed.match(/(\d+)\s*passed/)[1]);
      if (trimmed.match(/(\d+)\s*failed/)) failedTests = parseInt(trimmed.match(/(\d+)\s*failed/)[1]);
      if (trimmed.match(/(\d+)\s*skipped/)) skippedTests = parseInt(trimmed.match(/(\d+)\s*skipped/)[1]);
      totalTests = passedTests + failedTests + skippedTests;
      continue;
    }

    // cargo test: test result: FAILED. 2 passed; 1 failed;
    const cargoSummary = trimmed.match(/test result:.*?(\d+)\s*passed.*?(\d+)\s*failed/i);
    if (cargoSummary) {
      passedTests = parseInt(cargoSummary[1]);
      failedTests = parseInt(cargoSummary[2]);
      totalTests = passedTests + failedTests;
      continue;
    }

    // Node.js test runner: # tests 5, ℹ tests 3
    const nodeTests = trimmed.match(/(?:#|ℹ)?\s*tests\s+(\d+)/i);
    const nodePass = trimmed.match(/(?:#|ℹ)?\s*pass\s+(\d+)/i);
    const nodeFail = trimmed.match(/(?:#|ℹ)?\s*fail\s+(\d+)/i);
    if (nodeTests) totalTests = parseInt(nodeTests[1]);
    if (nodePass) passedTests = parseInt(nodePass[1]);
    if (nodeFail) failedTests = parseInt(nodeFail[1]);

    // go test: ok/FAIL package (time)
    const goSummary = trimmed.match(/^(ok|FAIL)\s+(\S+)\s+/);
    if (goSummary) {
      if (goSummary[1] === 'FAIL') {
        failures.push(`FAIL ${goSummary[2]}`);
        failedTests++;
      } else {
        passedTests++;
      }
      totalTests++;
      continue;
    }

    // Detect failure blocks
    // Jest: ● test name
    if (trimmed.startsWith('●') || trimmed.startsWith('✕') || trimmed.startsWith('✖') || trimmed.startsWith('FAIL ')) {
      if (currentFailure.length) failures.push(currentFailure.join('\n'));
      currentFailure = [trimmed];
      inFailure = true;
      continue;
    }

    // pytest: FAILED test_name
    if (trimmed.startsWith('FAILED') || trimmed.match(/^E\s+/)) {
      if (!inFailure && currentFailure.length) failures.push(currentFailure.join('\n'));
      currentFailure.push(trimmed);
      inFailure = true;
      continue;
    }

    // cargo test: test name ... FAILED
    if (trimmed.match(/^test\s+.+\.\.\.\s+FAILED/i)) {
      failures.push(trimmed);
      continue;
    }

    // Collect failure context (indented lines after a failure marker)
    if (inFailure && (line.startsWith('  ') || line.startsWith('\t'))) {
      if (currentFailure.length < 10) { // Cap context at 10 lines per failure
        currentFailure.push(trimmed);
      }
      continue;
    }

    // End of failure block
    if (inFailure && !line.startsWith('  ') && !line.startsWith('\t') && trimmed !== '') {
      if (currentFailure.length) failures.push(currentFailure.join('\n'));
      currentFailure = [];
      inFailure = false;
    }

    // Detect error lines
    if (trimmed.match(/^(Error|error\[|ERR!)/i)) {
      errors.push(trimmed);
    }
  }

  // Flush last failure
  if (currentFailure.length) failures.push(currentFailure.join('\n'));

  // Build compressed output
  const parts = [];

  // Summary line
  if (totalTests > 0) {
    const summaryParts = [];
    if (failedTests > 0) summaryParts.push(`${failedTests} failed`);
    if (passedTests > 0) summaryParts.push(`${passedTests} passed`);
    if (skippedTests > 0) summaryParts.push(`${skippedTests} skipped`);
    parts.push(`${totalTests} tests: ${summaryParts.join(', ')}`);
  }

  // Failures (capped at 5)
  if (failures.length) {
    const shown = failures.slice(0, 5);
    parts.push('FAILURES:');
    parts.push(...shown);
    if (failures.length > 5) parts.push(`... +${failures.length - 5} more failures`);
  }

  // Errors
  if (errors.length) {
    parts.push('ERRORS:');
    parts.push(...errors.slice(0, 3));
  }

  // If no structured info extracted, fall back to last few lines
  if (!parts.length) {
    const lastLines = lines.filter(l => l.trim()).slice(-5);
    const compressed = lastLines.join('\n');
    const savings = Math.round((1 - compressed.length / output.length) * 100);
    return { compressed, savings: Math.max(0, savings) };
  }

  const compressed = parts.join('\n');
  const savings = Math.round((1 - compressed.length / output.length) * 100);
  return { compressed, savings: Math.max(0, savings) };
}

/**
 * Route test command output to filter.
 */
export function filterTest(output, _args) {
  return filterTestOutput(output);
}
