import type { ReasoningCase } from "./types";

/**
 * MultiPL-E's JavaScript ports of HumanEval and MBPP (nuprl/MultiPL-E on the
 * Hugging Face Hub, humaneval-js and mbpp-js, MIT), assembled 2026-09-07:
 * 50 of each, evenly spaced through the dataset (four ports whose tests do
 * not parse were dropped first) and interleaved. The prompt is
 * the signature and doc comment as shipped; the tests are the ported asserts,
 * run in-process in a vm context. "jsthon" (a MultiPL-E rewording artefact
 * for "python") is spelled JavaScript.
 */
export const CODE_CASES: ReasoningCase[] = [
  {
    source: "HumanEval",
    id: "HumanEval_0_has_close_elements",
    domain: "javascript",
    title: "has_close_elements",
    kind: "code",
    question:
      "//Check if in given array of numbers, are any two numbers closer to each other than\n// given threshold.\n// >>> has_close_elements([1.0, 2.0, 3.0], 0.5)\n// false\n// >>> has_close_elements([1.0, 2.8, 3.0, 4.0, 5.0, 2.0], 0.3)\n// true\nfunction has_close_elements(numbers, threshold){\n",
    entryPoint: "has_close_elements",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = has_close_elements;\n  assert.deepEqual(candidate([1.0, 2.0, 3.9, 4.0, 5.0, 2.2], 0.3),true);\n  assert.deepEqual(candidate([1.0, 2.0, 3.9, 4.0, 5.0, 2.2], 0.05),false);\n  assert.deepEqual(candidate([1.0, 2.0, 5.9, 4.0, 5.0], 0.95),true);\n  assert.deepEqual(candidate([1.0, 2.0, 5.9, 4.0, 5.0], 0.8),false);\n  assert.deepEqual(candidate([1.0, 2.0, 3.0, 4.0, 5.0, 2.0], 0.1),true);\n  assert.deepEqual(candidate([1.1, 2.2, 3.1, 4.1, 5.1], 1.0),true);\n  assert.deepEqual(candidate([1.1, 2.2, 3.1, 4.1, 5.1], 0.5),false);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_3_is_not_prime",
    domain: "javascript",
    title: "is_not_prime",
    kind: "code",
    question:
      "//Write a JavaScript function to identify non-prime numbers.\nfunction is_not_prime(n){\n",
    entryPoint: "is_not_prime",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = is_not_prime;\n  assert.deepEqual(candidate(2),false);\n  assert.deepEqual(candidate(10),true);\n  assert.deepEqual(candidate(35),true);\n  assert.deepEqual(candidate(37),false);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_3_below_zero",
    domain: "javascript",
    title: "below_zero",
    kind: "code",
    question:
      "//You're given an array of deposit and withdrawal operations on a bank account that starts with\n// zero balance. Your task is to detect if at any point the balance of account fallls below zero, and\n// at that point function should return true. Otherwise it should return false.\n// >>> below_zero([1, 2, 3])\n// false\n// >>> below_zero([1, 2, -4, 5])\n// true\nfunction below_zero(operations){\n",
    entryPoint: "below_zero",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = below_zero;\n  assert.deepEqual(candidate([]),false);\n  assert.deepEqual(candidate([1, 2, -3, 1, 2, -3]),false);\n  assert.deepEqual(candidate([1, 2, -4, 5, 6]),true);\n  assert.deepEqual(candidate([1, -1, 2, -2, 5, -5, 4, -4]),false);\n  assert.deepEqual(candidate([1, -1, 2, -2, 5, -5, 4, -5]),true);\n  assert.deepEqual(candidate([1, -2, 2, -2, 5, -5, 4, -4]),true);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_14_find_Volume",
    domain: "javascript",
    title: "find_Volume",
    kind: "code",
    question:
      "//Write a JavaScript function to find the volume of a triangular prism.\nfunction find_Volume(l, b, h){\n",
    entryPoint: "find_Volume",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = find_Volume;\n  assert.deepEqual(candidate(10, 8, 6),240);\n  assert.deepEqual(candidate(3, 2, 2),6);\n  assert.deepEqual(candidate(1, 2, 1),1);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_6_parse_nested_parens",
    domain: "javascript",
    title: "parse_nested_parens",
    kind: "code",
    question:
      '//Input to this function is a string represented multiple groups for nested parentheses separated by spaces.\n// For each of the group, output the deepest level of nesting of parentheses.\n// E.g. (()()) has maximum two levels of nesting while ((())) has three.\n// >>> parse_nested_parens("(()()) ((())) () ((())()())")\n// [2, 3, 1, 3]\nfunction parse_nested_parens(paren_string){\n',
    entryPoint: "parse_nested_parens",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = parse_nested_parens;\n  assert.deepEqual(candidate("(()()) ((())) () ((())()())"),[2, 3, 1, 3]);\n  assert.deepEqual(candidate("() (()) ((())) (((())))"),[1, 2, 3, 4]);\n  assert.deepEqual(candidate("(()(())((())))"),[4]);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_58_opposite_Signs",
    domain: "javascript",
    title: "opposite_Signs",
    kind: "code",
    question:
      "//Write a JavaScript function to check whether the given two integers have opposite sign or not.\nfunction opposite_Signs(x, y){\n",
    entryPoint: "opposite_Signs",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = opposite_Signs;\n  assert.deepEqual(candidate(1, -2),true);\n  assert.deepEqual(candidate(3, 2),false);\n  assert.deepEqual(candidate(-10, -10),false);\n  assert.deepEqual(candidate(-2, 2),true);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_9_rolling_max",
    domain: "javascript",
    title: "rolling_max",
    kind: "code",
    question:
      "//From a given array of integers, generate an array of rolling maximum element found until given moment\n// in the sequence.\n// >>> rolling_max([1, 2, 3, 2, 3, 4, 2])\n// [1, 2, 3, 3, 3, 4, 4]\nfunction rolling_max(numbers){\n",
    entryPoint: "rolling_max",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = rolling_max;\n  assert.deepEqual(candidate([]),[]);\n  assert.deepEqual(candidate([1, 2, 3, 4]),[1, 2, 3, 4]);\n  assert.deepEqual(candidate([4, 3, 2, 1]),[4, 4, 4, 4]);\n  assert.deepEqual(candidate([3, 2, 3, 100, 3]),[3, 3, 3, 100, 100]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_67_bell_number",
    domain: "javascript",
    title: "bell_number",
    kind: "code",
    question:
      "//Write a function to find the number of ways to partition a set of Bell numbers.\nfunction bell_number(n){\n",
    entryPoint: "bell_number",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = bell_number;\n  assert.deepEqual(candidate(2),2);\n  assert.deepEqual(candidate(10),115975);\n  assert.deepEqual(candidate(56),6775685320645824322581483068371419745979053216268760300);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_12_longest",
    domain: "javascript",
    title: "longest",
    kind: "code",
    question:
      '//Out of array of strings, return the longest one. Return the first one in case of multiple\n// strings of the same length. Return undefined in case the input array is empty.\n// >>> longest([])\n// undefined\n// >>> longest(["a", "b", "c"])\n// "a"\n// >>> longest(["a", "bb", "ccc"])\n// "ccc"\nfunction longest(strings){\n',
    entryPoint: "longest",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = longest;\n  assert.deepEqual(candidate([]),undefined);\n  assert.deepEqual(candidate(["x", "y", "z"]),"x");\n  assert.deepEqual(candidate(["x", "yyy", "zzzz", "www", "kkkk", "abc"]),"zzzz");\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_77_is_Diff",
    domain: "javascript",
    title: "is_Diff",
    kind: "code",
    question:
      "//Write a JavaScript function to find whether a number is divisible by 11.\nfunction is_Diff(n){\n",
    entryPoint: "is_Diff",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = is_Diff;\n  assert.deepEqual(candidate(12345),false);\n  assert.deepEqual(candidate(1212112),true);\n  assert.deepEqual(candidate(1212),false);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_16_count_distinct_characters",
    domain: "javascript",
    title: "count_distinct_characters",
    kind: "code",
    question:
      '//Given a string, find out how many distinct characters (regardless of case) does it consist of\n// >>> count_distinct_characters("xyzXYZ")\n// 3\n// >>> count_distinct_characters("Jerry")\n// 4\nfunction count_distinct_characters(string){\n',
    entryPoint: "count_distinct_characters",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = count_distinct_characters;\n  assert.deepEqual(candidate(""),0);\n  assert.deepEqual(candidate("abcde"),5);\n  assert.deepEqual(candidate("abcdecadeCADE"),5);\n  assert.deepEqual(candidate("aaaaAAAAaaaa"),1);\n  assert.deepEqual(candidate("Jerry jERRY JeRRRY"),5);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_89_closest_num",
    domain: "javascript",
    title: "closest_num",
    kind: "code",
    question:
      "//Write a function to find the closest smaller number than n.\nfunction closest_num(N){\n",
    entryPoint: "closest_num",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = closest_num;\n  assert.deepEqual(candidate(11),10);\n  assert.deepEqual(candidate(7),6);\n  assert.deepEqual(candidate(12),11);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_19_sort_numbers",
    domain: "javascript",
    title: "sort_numbers",
    kind: "code",
    question:
      "//Input is a space-delimited string of numberals from 'zero' to 'nine'.\n// Valid choices are 'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight' and 'nine'.\n// Return the string with numbers sorted from smallest to largest\n// >>> sort_numbers(\"three one five\")\n// \"one three five\"\nfunction sort_numbers(numbers){\n",
    entryPoint: "sort_numbers",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = sort_numbers;\n  assert.deepEqual(candidate(""),"");\n  assert.deepEqual(candidate("three"),"three");\n  assert.deepEqual(candidate("three five nine"),"three five nine");\n  assert.deepEqual(candidate("five zero four seven nine eight"),"zero four five seven eight nine");\n  assert.deepEqual(candidate("six five four three two one zero"),"zero one two three four five six");\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_97_frequency_lists",
    domain: "javascript",
    title: "frequency_lists",
    kind: "code",
    question:
      "//Write a function to find frequency of each element in a flattened array of arrays, returned in an object.\nfunction frequency_lists(list1){\n",
    entryPoint: "frequency_lists",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = frequency_lists;\n  assert.deepEqual(candidate([[1, 2, 3, 2], [4, 5, 6, 2], [7, 8, 9, 5]]),{1: 1, 2: 3, 3: 1, 4: 1, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1});\n  assert.deepEqual(candidate([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]),{1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1});\n  assert.deepEqual(candidate([[20, 30, 40, 17], [18, 16, 14, 13], [10, 20, 30, 40]]),{20: 2, 30: 2, 40: 2, 17: 1, 18: 1, 16: 1, 14: 1, 13: 1, 10: 1});\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_22_filter_integers",
    domain: "javascript",
    title: "filter_integers",
    kind: "code",
    question:
      '//Filter given array of any JavaScript values only for integers\n// >>> filter_integers(["a", 3.14, 5])\n// [5]\n// >>> filter_integers([1, 2, 3, "abc", {}, []])\n// [1, 2, 3]\nfunction filter_integers(values){\n',
    entryPoint: "filter_integers",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = filter_integers;\n  assert.deepEqual(candidate([]),[]);\n  assert.deepEqual(candidate([4, {}, [], 23.2, 9, "adasd"]),[4, 9]);\n  assert.deepEqual(candidate([3, "c", 3, 3, "a", "b"]),[3, 3, 3]);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_106_add_lists",
    domain: "javascript",
    title: "add_lists",
    kind: "code",
    question:
      "//Write a function to append the given array to the given arrays.\nfunction add_lists(test_list, test_tup){\n",
    entryPoint: "add_lists",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = add_lists;\n  assert.deepEqual(candidate([5, 6, 7], [9, 10]),[9, 10, 5, 6, 7]);\n  assert.deepEqual(candidate([6, 7, 8], [10, 11]),[10, 11, 6, 7, 8]);\n  assert.deepEqual(candidate([7, 8, 9], [11, 12]),[11, 12, 7, 8, 9]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_25_factorize",
    domain: "javascript",
    title: "factorize",
    kind: "code",
    question:
      "//Return array of prime factors of given integer in the order from smallest to largest.\n// Each of the factors should be arrayed number of times corresponding to how many times it appeares in factorization.\n// Input number should be equal to the product of all factors\n// >>> factorize(8)\n// [2, 2, 2]\n// >>> factorize(25)\n// [5, 5]\n// >>> factorize(70)\n// [2, 5, 7]\nfunction factorize(n){\n",
    entryPoint: "factorize",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = factorize;\n  assert.deepEqual(candidate(2),[2]);\n  assert.deepEqual(candidate(4),[2, 2]);\n  assert.deepEqual(candidate(8),[2, 2, 2]);\n  assert.deepEqual(candidate(57),[3, 19]);\n  assert.deepEqual(candidate(3249),[3, 3, 19, 19]);\n  assert.deepEqual(candidate(185193),[3, 3, 3, 19, 19, 19]);\n  assert.deepEqual(candidate(20577),[3, 19, 19, 19]);\n  assert.deepEqual(candidate(18),[2, 3, 3]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_120_max_product_tuple",
    domain: "javascript",
    title: "max_product_tuple",
    kind: "code",
    question:
      "//Write a function to find the maximum absolute product between numbers in pairs of arrays within a given array.\nfunction max_product_tuple(list1){\n",
    entryPoint: "max_product_tuple",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = max_product_tuple;\n  assert.deepEqual(candidate([[2, 7], [2, 6], [1, 8], [4, 9]]),36);\n  assert.deepEqual(candidate([[10, 20], [15, 2], [5, 10]]),200);\n  assert.deepEqual(candidate([[11, 44], [10, 15], [20, 5], [12, 9]]),484);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_28_concatenate",
    domain: "javascript",
    title: "concatenate",
    kind: "code",
    question:
      '//Concatenate array of strings into a single string\n// >>> concatenate([])\n// ""\n// >>> concatenate(["a", "b", "c"])\n// "abc"\nfunction concatenate(strings){\n',
    entryPoint: "concatenate",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = concatenate;\n  assert.deepEqual(candidate([]),"");\n  assert.deepEqual(candidate(["x", "y", "z"]),"xyz");\n  assert.deepEqual(candidate(["x", "y", "z", "w", "k"]),"xyzwk");\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_130_max_occurrences",
    domain: "javascript",
    title: "max_occurrences",
    kind: "code",
    question:
      "//Write a function to find the item with maximum frequency in a given array.\nfunction max_occurrences(nums){\n",
    entryPoint: "max_occurrences",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = max_occurrences;\n  assert.deepEqual(candidate([2, 3, 8, 4, 7, 9, 8, 2, 6, 5, 1, 6, 1, 2, 3, 2, 4, 6, 9, 1, 2]),2);\n  assert.deepEqual(candidate([2, 3, 8, 4, 7, 9, 8, 7, 9, 15, 14, 10, 12, 13, 16, 18]),8);\n  assert.deepEqual(candidate([10, 20, 20, 30, 40, 90, 80, 50, 30, 20, 50, 10]),20);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_33_sort_third",
    domain: "javascript",
    title: "sort_third",
    kind: "code",
    question:
      "//This function takes an array l and returns an array l' such that\n// l' is identical to l in the indicies that are not divisible by three, while its values at the indicies that are divisible by three are equal\n// to the values of the corresponding indicies of l, but sorted.\n// >>> sort_third([1, 2, 3])\n// [1, 2, 3]\n// >>> sort_third([5, 6, 3, 4, 8, 9, 2])\n// [2, 6, 3, 4, 8, 9, 5]\nfunction sort_third(l){\n",
    entryPoint: "sort_third",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = sort_third;\n  assert.deepEqual(candidate([5, 6, 3, 4, 8, 9, 2]),[2, 6, 3, 4, 8, 9, 5]);\n  assert.deepEqual(candidate([5, 8, 3, 4, 6, 9, 2]),[2, 8, 3, 4, 6, 9, 5]);\n  assert.deepEqual(candidate([5, 6, 9, 4, 8, 3, 2]),[2, 6, 9, 4, 8, 3, 5]);\n  assert.deepEqual(candidate([5, 6, 3, 4, 8, 9, 2, 1]),[2, 6, 3, 4, 8, 9, 5, 1]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_143_find_lists",
    domain: "javascript",
    title: "find_lists",
    kind: "code",
    question:
      "//Write a function to find number of arrays present in the given array.\nfunction find_lists(Input){\n",
    entryPoint: "find_lists",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = find_lists;\n  assert.deepEqual(candidate([[1, 2, 3, 4], [5, 6, 7, 8]]),2);\n  assert.deepEqual(candidate([[1, 2], [3, 4], [5, 6]]),3);\n  assert.deepEqual(candidate([9, 8, 7, 6, 5, 4, 3, 2, 1]),1);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_36_fizz_buzz",
    domain: "javascript",
    title: "fizz_buzz",
    kind: "code",
    question:
      "//Return the number of times the digit 7 appears in integers less than n which are divisible by 11 or 13.\n// >>> fizz_buzz(50)\n// 0\n// >>> fizz_buzz(78)\n// 2\n// >>> fizz_buzz(79)\n// 3\nfunction fizz_buzz(n){\n",
    entryPoint: "fizz_buzz",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = fizz_buzz;\n  assert.deepEqual(candidate(50),0);\n  assert.deepEqual(candidate(78),2);\n  assert.deepEqual(candidate(79),3);\n  assert.deepEqual(candidate(100),3);\n  assert.deepEqual(candidate(200),6);\n  assert.deepEqual(candidate(4000),192);\n  assert.deepEqual(candidate(10000),639);\n  assert.deepEqual(candidate(100000),8026);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_167_next_power_of_2",
    domain: "javascript",
    title: "next_power_of_2",
    kind: "code",
    question:
      "//Write a JavaScript function to find the smallest power of 2 greater than or equal to n.\nfunction next_power_of_2(n){\n",
    entryPoint: "next_power_of_2",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = next_power_of_2;\n  assert.deepEqual(candidate(0),1);\n  assert.deepEqual(candidate(5),8);\n  assert.deepEqual(candidate(17),32);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_40_triples_sum_to_zero",
    domain: "javascript",
    title: "triples_sum_to_zero",
    kind: "code",
    question:
      "//triples_sum_to_zero takes an array of integers as an input.\n// it returns true if there are three distinct elements in the array that\n// sum to zero, and false otherwise.\n// >>> triples_sum_to_zero([1, 3, 5, 0])\n// false\n// >>> triples_sum_to_zero([1, 3, -2, 1])\n// true\n// >>> triples_sum_to_zero([1, 2, 3, 7])\n// false\n// >>> triples_sum_to_zero([2, 4, -5, 3, 9, 7])\n// true\n// >>> triples_sum_to_zero([1])\n// false\nfunction triples_sum_to_zero(l){\n",
    entryPoint: "triples_sum_to_zero",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = triples_sum_to_zero;\n  assert.deepEqual(candidate([1, 3, 5, 0]),false);\n  assert.deepEqual(candidate([1, 3, 5, -1]),false);\n  assert.deepEqual(candidate([1, 3, -2, 1]),true);\n  assert.deepEqual(candidate([1, 2, 3, 7]),false);\n  assert.deepEqual(candidate([1, 2, 5, 7]),false);\n  assert.deepEqual(candidate([2, 4, -5, 3, 9, 7]),true);\n  assert.deepEqual(candidate([1]),false);\n  assert.deepEqual(candidate([1, 3, 5, -100]),false);\n  assert.deepEqual(candidate([100, 3, 5, -100]),false);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_226_odd_values_string",
    domain: "javascript",
    title: "odd_values_string",
    kind: "code",
    question:
      "//Write a JavaScript function to remove the characters which have odd index values of a given string.\nfunction odd_values_string(str){\n",
    entryPoint: "odd_values_string",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = odd_values_string;\n  assert.deepEqual(candidate("abcdef"),"ace");\n  assert.deepEqual(candidate("python"),"pto");\n  assert.deepEqual(candidate("data"),"dt");\n  assert.deepEqual(candidate("lambs"),"lms");\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_43_pairs_sum_to_zero",
    domain: "javascript",
    title: "pairs_sum_to_zero",
    kind: "code",
    question:
      "//pairs_sum_to_zero takes an array of integers as an input.\n// it returns true if there are two distinct elements in the array that\n// sum to zero, and false otherwise.\n// >>> pairs_sum_to_zero([1, 3, 5, 0])\n// false\n// >>> pairs_sum_to_zero([1, 3, -2, 1])\n// false\n// >>> pairs_sum_to_zero([1, 2, 3, 7])\n// false\n// >>> pairs_sum_to_zero([2, 4, -5, 3, 5, 7])\n// true\n// >>> pairs_sum_to_zero([1])\n// false\nfunction pairs_sum_to_zero(l){\n",
    entryPoint: "pairs_sum_to_zero",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = pairs_sum_to_zero;\n  assert.deepEqual(candidate([1, 3, 5, 0]),false);\n  assert.deepEqual(candidate([1, 3, -2, 1]),false);\n  assert.deepEqual(candidate([1, 2, 3, 7]),false);\n  assert.deepEqual(candidate([2, 4, -5, 3, 5, 7]),true);\n  assert.deepEqual(candidate([1]),false);\n  assert.deepEqual(candidate([-3, 9, -1, 3, 2, 30]),true);\n  assert.deepEqual(candidate([-3, 9, -1, 3, 2, 31]),true);\n  assert.deepEqual(candidate([-3, 9, -1, 4, 2, 30]),false);\n  assert.deepEqual(candidate([-3, 9, -1, 4, 2, 31]),false);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_240_replace_list",
    domain: "javascript",
    title: "replace_list",
    kind: "code",
    question:
      "//Write a function that takes in two arrays and replaces the last element of the first array with the elements of the second array.\nfunction replace_list(list1, list2){\n",
    entryPoint: "replace_list",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = replace_list;\n  assert.deepEqual(candidate([1, 3, 5, 7, 9, 10], [2, 4, 6, 8]),[1, 3, 5, 7, 9, 2, 4, 6, 8]);\n  assert.deepEqual(candidate([1, 2, 3, 4, 5], [5, 6, 7, 8]),[1, 2, 3, 4, 5, 6, 7, 8]);\n  assert.deepEqual(candidate(["red", "blue", "green"], ["yellow"]),["red", "blue", "yellow"]);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_46_fib4",
    domain: "javascript",
    title: "fib4",
    kind: "code",
    question:
      "//The Fib4 number sequence is a sequence similar to the Fibbonacci sequnece that's defined as follows:\n// fib4(0) -> 0\n// fib4(1) -> 0\n// fib4(2) -> 2\n// fib4(3) -> 0\n// fib4(n) -> fib4(n-1) + fib4(n-2) + fib4(n-3) + fib4(n-4).\n// Please write a function to efficiently compute the n-th element of the fib4 number sequence.  Do not use recursion.\n// >>> fib4(5)\n// 4\n// >>> fib4(6)\n// 8\n// >>> fib4(7)\n// 14\nfunction fib4(n){\n",
    entryPoint: "fib4",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = fib4;\n  assert.deepEqual(candidate(5),4);\n  assert.deepEqual(candidate(8),28);\n  assert.deepEqual(candidate(10),104);\n  assert.deepEqual(candidate(12),386);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_252_convert",
    domain: "javascript",
    title: "convert",
    kind: "code",
    question:
      "//Write a JavaScript function to convert complex numbers to polar coordinates.\nfunction convert(numbers){\n",
    entryPoint: "convert",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = convert;\n  assert.deepEqual(candidate(1),[1.0, 0.0]);\n  assert.deepEqual(candidate(4),[4.0, 0.0]);\n  assert.deepEqual(candidate(5),[5.0, 0.0]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_52_below_threshold",
    domain: "javascript",
    title: "below_threshold",
    kind: "code",
    question:
      "//Return true if all numbers in the array l are below threshold t.\n// >>> below_threshold([1, 2, 4, 10], 100)\n// true\n// >>> below_threshold([1, 20, 4, 10], 5)\n// false\nfunction below_threshold(l, t){\n",
    entryPoint: "below_threshold",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = below_threshold;\n  assert.deepEqual(candidate([1, 2, 4, 10], 100),true);\n  assert.deepEqual(candidate([1, 20, 4, 10], 5),false);\n  assert.deepEqual(candidate([1, 20, 4, 10], 21),true);\n  assert.deepEqual(candidate([1, 20, 4, 10], 22),true);\n  assert.deepEqual(candidate([1, 8, 4, 10], 11),true);\n  assert.deepEqual(candidate([1, 8, 4, 10], 10),false);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_262_split_two_parts",
    domain: "javascript",
    title: "split_two_parts",
    kind: "code",
    question:
      "//Write a function that takes in an array and an integer L and splits the given array into two parts where the length of the first part of the array is L, and returns the resulting arrays in an array.\nfunction split_two_parts(list1, L){\n",
    entryPoint: "split_two_parts",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = split_two_parts;\n  assert.deepEqual(candidate([1, 1, 2, 3, 4, 4, 5, 1], 3),[[1, 1, 2], [3, 4, 4, 5, 1]]);\n  assert.deepEqual(candidate(["a", "b", "c", "d"], 2),[["a", "b"], ["c", "d"]]);\n  assert.deepEqual(candidate(["p", "y", "t", "h", "o", "n"], 4),[["p", "y", "t", "h"], ["o", "n"]]);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_55_fib",
    domain: "javascript",
    title: "fib",
    kind: "code",
    question:
      "//Return n-th Fibonacci number.\n// >>> fib(10)\n// 55\n// >>> fib(1)\n// 1\n// >>> fib(8)\n// 21\nfunction fib(n){\n",
    entryPoint: "fib",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = fib;\n  assert.deepEqual(candidate(10),55);\n  assert.deepEqual(candidate(1),1);\n  assert.deepEqual(candidate(8),21);\n  assert.deepEqual(candidate(11),89);\n  assert.deepEqual(candidate(12),144);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_271_even_Power_Sum",
    domain: "javascript",
    title: "even_Power_Sum",
    kind: "code",
    question:
      "//Write a JavaScript function that takes in an integer n and finds the sum of the first n even natural numbers that are raised to the fifth power.\nfunction even_Power_Sum(n){\n",
    entryPoint: "even_Power_Sum",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = even_Power_Sum;\n  assert.deepEqual(candidate(2),1056);\n  assert.deepEqual(candidate(3),8832);\n  assert.deepEqual(candidate(1),32);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_58_common",
    domain: "javascript",
    title: "common",
    kind: "code",
    question:
      "//Return sorted unique common elements for two arrays.\n// >>> common([1, 4, 3, 34, 653, 2, 5], [5, 7, 1, 5, 9, 653, 121])\n// [1, 5, 653]\n// >>> common([5, 3, 2, 8], [3, 2])\n// [2, 3]\nfunction common(l1, l2){\n",
    entryPoint: "common",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = common;\n  assert.deepEqual(candidate([1, 4, 3, 34, 653, 2, 5], [5, 7, 1, 5, 9, 653, 121]),[1, 5, 653]);\n  assert.deepEqual(candidate([5, 3, 2, 8], [3, 2]),[2, 3]);\n  assert.deepEqual(candidate([4, 3, 2, 8], [3, 2, 4]),[2, 3, 4]);\n  assert.deepEqual(candidate([4, 3, 2, 8], []),[]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_280_sequential_search",
    domain: "javascript",
    title: "sequential_search",
    kind: "code",
    question:
      "//Write a function that takes in an array and element and returns an array containing a boolean that indicates if the element is in the array and the index position of the element (or -1 if the element is not found).\nfunction sequential_search(dlist, item){\n",
    entryPoint: "sequential_search",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = sequential_search;\n  assert.deepEqual(candidate([11, 23, 58, 31, 56, 77, 43, 12, 65, 19], 31),[true, 3]);\n  assert.deepEqual(candidate([12, 32, 45, 62, 35, 47, 44, 61], 61),[true, 7]);\n  assert.deepEqual(candidate([9, 10, 17, 19, 22, 39, 48, 56], 48),[true, 6]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_61_correct_bracketing",
    domain: "javascript",
    title: "correct_bracketing",
    kind: "code",
    question:
      '//brackets is a string of "(" and ")".\n// return true if every opening bracket has a corresponding closing bracket.\n// >>> correct_bracketing("(")\n// false\n// >>> correct_bracketing("()")\n// true\n// >>> correct_bracketing("(()())")\n// true\n// >>> correct_bracketing(")(()")\n// false\nfunction correct_bracketing(brackets){\n',
    entryPoint: "correct_bracketing",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = correct_bracketing;\n  assert.deepEqual(candidate("()"),true);\n  assert.deepEqual(candidate("(()())"),true);\n  assert.deepEqual(candidate("()()(()())()"),true);\n  assert.deepEqual(candidate("()()((()()())())(()()(()))"),true);\n  assert.deepEqual(candidate("((()())))"),false);\n  assert.deepEqual(candidate(")(()"),false);\n  assert.deepEqual(candidate("("),false);\n  assert.deepEqual(candidate("(((("),false);\n  assert.deepEqual(candidate(")"),false);\n  assert.deepEqual(candidate("(()"),false);\n  assert.deepEqual(candidate("()()(()())())(()"),false);\n  assert.deepEqual(candidate("()()(()())()))()"),false);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_290_max_length",
    domain: "javascript",
    title: "max_length",
    kind: "code",
    question:
      "//Write a function to find the array of maximum length in an array of arrays.\nfunction max_length(list1){\n",
    entryPoint: "max_length",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = max_length;\n  assert.deepEqual(candidate([[0], [1, 3], [5, 7], [9, 11], [13, 15, 17]]),[3, [13, 15, 17]]);\n  assert.deepEqual(candidate([[1], [5, 7], [10, 12, 14, 15]]),[4, [10, 12, 14, 15]]);\n  assert.deepEqual(candidate([[5], [15, 20, 25]]),[3, [15, 20, 25]]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_64_vowels_count",
    domain: "javascript",
    title: "vowels_count",
    kind: "code",
    question:
      "//Write a function vowels_count which takes a string representing\n// a word as input and returns the number of vowels in the string.\n// Vowels in this case are 'a', 'e', 'i', 'o', 'u'. Here, 'y' is also a\n// vowel, but only when it is at the end of the given word.\n// Example:\n// >>> vowels_count(\"abcde\")\n// 2\n// >>> vowels_count(\"ACEDY\")\n// 3\nfunction vowels_count(s){\n",
    entryPoint: "vowels_count",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = vowels_count;\n  assert.deepEqual(candidate("abcde"),2);\n  assert.deepEqual(candidate("Alone"),3);\n  assert.deepEqual(candidate("key"),2);\n  assert.deepEqual(candidate("bye"),1);\n  assert.deepEqual(candidate("keY"),2);\n  assert.deepEqual(candidate("bYe"),1);\n  assert.deepEqual(candidate("ACEDY"),3);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_299_max_aggregate",
    domain: "javascript",
    title: "max_aggregate",
    kind: "code",
    question:
      "//Write a function to calculate the maximum aggregate from the array of arrays.\nfunction max_aggregate(stdata){\n",
    entryPoint: "max_aggregate",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = max_aggregate;\n  assert.deepEqual(candidate([["Juan Whelan", 90], ["Sabah Colley", 88], ["Peter Nichols", 7], ["Juan Whelan", 122], ["Sabah Colley", 84]]),["Juan Whelan", 212]);\n  assert.deepEqual(candidate([["Juan Whelan", 50], ["Sabah Colley", 48], ["Peter Nichols", 37], ["Juan Whelan", 22], ["Sabah Colley", 14]]),["Juan Whelan", 72]);\n  assert.deepEqual(candidate([["Juan Whelan", 10], ["Sabah Colley", 20], ["Peter Nichols", 30], ["Juan Whelan", 40], ["Sabah Colley", 50]]),["Sabah Colley", 70]);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_68_pluck",
    domain: "javascript",
    title: "pluck",
    kind: "code",
    question:
      '//"Given an array representing a branch of a tree that has non-negative integer nodes\n// your task is to pluck one of the nodes and return it.\n// The plucked node should be the node with the smallest even value.\n// If multiple nodes with the same smallest even value are found return the node that has smallest index.\n// The plucked node should be returned in an array, [ smalest_value, its index ],\n// If there are no even values or the given array is empty, return [].\n// Example 1:\n// >>> pluck([4, 2, 3])\n// [2, 1]\n// Explanation: 2 has the smallest even value, and 2 has the smallest index.\n// Example 2:\n// >>> pluck([1, 2, 3])\n// [2, 1]\n// Explanation: 2 has the smallest even value, and 2 has the smallest index.\n// Example 3:\n// >>> pluck([])\n// []\n// Example 4:\n// >>> pluck([5, 0, 3, 0, 4, 2])\n// [0, 1]\n// Explanation: 0 is the smallest value, but  there are two zeros,\n// so we will choose the first zero, which has the smallest index.\n// Constraints:\n// * 1 <= nodes.length <= 10000\n// * 0 <= node.value\nfunction pluck(arr){\n',
    entryPoint: "pluck",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = pluck;\n  assert.deepEqual(candidate([4, 2, 3]),[2, 1]);\n  assert.deepEqual(candidate([1, 2, 3]),[2, 1]);\n  assert.deepEqual(candidate([]),[]);\n  assert.deepEqual(candidate([5, 0, 3, 0, 4, 2]),[0, 1]);\n  assert.deepEqual(candidate([1, 2, 3, 0, 5, 3]),[0, 3]);\n  assert.deepEqual(candidate([5, 4, 8, 4, 8]),[4, 1]);\n  assert.deepEqual(candidate([7, 6, 7, 1]),[6, 1]);\n  assert.deepEqual(candidate([7, 9, 7, 1]),[]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_389_find_lucas",
    domain: "javascript",
    title: "find_lucas",
    kind: "code",
    question:
      "//Write a function to find the n'th lucas number.\nfunction find_lucas(n){\n",
    entryPoint: "find_lucas",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = find_lucas;\n  assert.deepEqual(candidate(9),76);\n  assert.deepEqual(candidate(4),7);\n  assert.deepEqual(candidate(3),4);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_71_triangle_area",
    domain: "javascript",
    title: "triangle_area",
    kind: "code",
    question:
      "//Given the lengths of the three sides of a triangle. Return the area of\n// the triangle rounded to 2 decimal points if the three sides form a valid triangle. \n// Otherwise return -1\n// Three sides make a valid triangle when the sum of any two sides is greater \n// than the third side.\n// Example:\n// >>> triangle_area(3, 4, 5)\n// 6.0\n// >>> triangle_area(1, 2, 10)\n// -1\nfunction triangle_area(a, b, c){\n",
    entryPoint: "triangle_area",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = triangle_area;\n  assert.deepEqual(candidate(3, 4, 5),6.0);\n  assert.deepEqual(candidate(1, 2, 10),-1);\n  assert.deepEqual(candidate(4, 8, 5),8.18);\n  assert.deepEqual(candidate(2, 2, 2),1.73);\n  assert.deepEqual(candidate(1, 2, 3),-1);\n  assert.deepEqual(candidate(10, 5, 7),16.25);\n  assert.deepEqual(candidate(2, 6, 3),-1);\n  assert.deepEqual(candidate(1, 1, 1),0.43);\n  assert.deepEqual(candidate(2, 2, 10),-1);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_397_median_numbers",
    domain: "javascript",
    title: "median_numbers",
    kind: "code",
    question:
      "//Write a function to find the median of three numbers.\nfunction median_numbers(a, b, c){\n",
    entryPoint: "median_numbers",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = median_numbers;\n  assert.deepEqual(candidate(25, 55, 65),55.0);\n  assert.deepEqual(candidate(20, 10, 30),20.0);\n  assert.deepEqual(candidate(15, 45, 75),45.0);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_74_total_match",
    domain: "javascript",
    title: "total_match",
    kind: "code",
    question:
      '//Write a function that accepts two arrays of strings and returns the array that has \n// total number of chars in the all strings of the array less than the other array.\n// if the two arrays have the same number of chars, return the first array.\n// Examples\n// >>> total_match([], [])\n// []\n// >>> total_match(["hi", "admin"], ["hI", "Hi"])\n// ["hI", "Hi"]\n// >>> total_match(["hi", "admin"], ["hi", "hi", "admin", "project"])\n// ["hi", "admin"]\n// >>> total_match(["hi", "admin"], ["hI", "hi", "hi"])\n// ["hI", "hi", "hi"]\n// >>> total_match(["4"], ["1", "2", "3", "4", "5"])\n// ["4"]\nfunction total_match(lst1, lst2){\n',
    entryPoint: "total_match",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = total_match;\n  assert.deepEqual(candidate([], []),[]);\n  assert.deepEqual(candidate(["hi", "admin"], ["hi", "hi"]),["hi", "hi"]);\n  assert.deepEqual(candidate(["hi", "admin"], ["hi", "hi", "admin", "project"]),["hi", "admin"]);\n  assert.deepEqual(candidate(["4"], ["1", "2", "3", "4", "5"]),["4"]);\n  assert.deepEqual(candidate(["hi", "admin"], ["hI", "Hi"]),["hI", "Hi"]);\n  assert.deepEqual(candidate(["hi", "admin"], ["hI", "hi", "hi"]),["hI", "hi", "hi"]);\n  assert.deepEqual(candidate(["hi", "admin"], ["hI", "hi", "hii"]),["hi", "admin"]);\n  assert.deepEqual(candidate([], ["this"]),[]);\n  assert.deepEqual(candidate(["this"], []),[]);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_407_rearrange_bigger",
    domain: "javascript",
    title: "rearrange_bigger",
    kind: "code",
    question:
      "//Write a function to create the next bigger number by rearranging the digits of a given number.\nfunction rearrange_bigger(n){\n",
    entryPoint: "rearrange_bigger",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = rearrange_bigger;\n  assert.deepEqual(candidate(12),21);\n  assert.deepEqual(candidate(10),false);\n  assert.deepEqual(candidate(102),120);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_77_iscube",
    domain: "javascript",
    title: "iscube",
    kind: "code",
    question:
      "//Write a function that takes an integer a and returns true \n// if this ingeger is a cube of some integer number.\n// Note: you may assume the input is always valid.\n// Examples:\n// >>> iscube(1)\n// true\n// >>> iscube(2)\n// false\n// >>> iscube(-1)\n// true\n// >>> iscube(64)\n// true\n// >>> iscube(0)\n// true\n// >>> iscube(180)\n// false\nfunction iscube(a){\n",
    entryPoint: "iscube",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = iscube;\n  assert.deepEqual(candidate(1),true);\n  assert.deepEqual(candidate(2),false);\n  assert.deepEqual(candidate(-1),true);\n  assert.deepEqual(candidate(64),true);\n  assert.deepEqual(candidate(180),false);\n  assert.deepEqual(candidate(1000),true);\n  assert.deepEqual(candidate(0),true);\n  assert.deepEqual(candidate(1729),false);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_415_max_Product",
    domain: "javascript",
    title: "max_Product",
    kind: "code",
    question:
      "//Write a JavaScript function to find a pair with highest product from a given array of integers.\nfunction max_Product(arr){\n",
    entryPoint: "max_Product",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = max_Product;\n  assert.deepEqual(candidate([1, 2, 3, 4, 7, 0, 8, 4]),[7, 8]);\n  assert.deepEqual(candidate([0, -1, -2, -4, 5, 0, -6]),[-4, -6]);\n  assert.deepEqual(candidate([1, 2, 3]),[2, 3]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_80_is_happy",
    domain: "javascript",
    title: "is_happy",
    kind: "code",
    question:
      '//You are given a string s.\n// Your task is to check if the string is hapjs or not.\n// A string is hapjs if its length is at least 3 and every 3 consecutive letters are distinct\n// For example:\n// >>> is_happy("a")\n// false\n// >>> is_happy("aa")\n// false\n// >>> is_happy("abcd")\n// true\n// >>> is_happy("aabb")\n// false\n// >>> is_happy("adb")\n// true\n// >>> is_happy("xyy")\n// false\nfunction is_happy(s){\n',
    entryPoint: "is_happy",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = is_happy;\n  assert.deepEqual(candidate("a"),false);\n  assert.deepEqual(candidate("aa"),false);\n  assert.deepEqual(candidate("abcd"),true);\n  assert.deepEqual(candidate("aabb"),false);\n  assert.deepEqual(candidate("adb"),true);\n  assert.deepEqual(candidate("xyy"),false);\n  assert.deepEqual(candidate("iopaxpoi"),true);\n  assert.deepEqual(candidate("iopaxioi"),false);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_425_count_element_in_list",
    domain: "javascript",
    title: "count_element_in_list",
    kind: "code",
    question:
      "//Write a function to count the number of subarrays containing a particular element.\nfunction count_element_in_list(list1, x){\n",
    entryPoint: "count_element_in_list",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = count_element_in_list;\n  assert.deepEqual(candidate([[1, 3], [5, 7], [1, 11], [1, 15, 7]], 1),3);\n  assert.deepEqual(candidate([["A", "B"], ["A", "C"], ["A", "D", "E"], ["B", "C", "D"]], "A"),3);\n  assert.deepEqual(candidate([["A", "B"], ["A", "C"], ["A", "D", "E"], ["B", "C", "D"]], "E"),1);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_84_solve",
    domain: "javascript",
    title: "solve",
    kind: "code",
    question:
      '//Given a positive integer N, return the total sum of its digits in binary.\n// Example\n// >>> solve(1000)\n// "1"\n// >>> solve(150)\n// "110"\n// >>> solve(147)\n// "1100"\n// Variables:\n// @N integer\n// Constraints: 0 ≤ N ≤ 10000.\n// Output:\n// a string of binary number\nfunction solve(N){\n',
    entryPoint: "solve",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = solve;\n  assert.deepEqual(candidate(1000),"1");\n  assert.deepEqual(candidate(150),"110");\n  assert.deepEqual(candidate(147),"1100");\n  assert.deepEqual(candidate(333),"1001");\n  assert.deepEqual(candidate(963),"10010");\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_433_check_greater",
    domain: "javascript",
    title: "check_greater",
    kind: "code",
    question:
      "//Write a function to check whether the entered number is greater than the elements of the given array.\nfunction check_greater(arr, number){\n",
    entryPoint: "check_greater",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = check_greater;\n  assert.deepEqual(candidate([1, 2, 3, 4, 5], 4),false);\n  assert.deepEqual(candidate([2, 3, 4, 5, 6], 8),true);\n  assert.deepEqual(candidate([9, 7, 4, 8, 6, 1], 11),true);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_87_get_row",
    domain: "javascript",
    title: "get_row",
    kind: "code",
    question:
      "//You are given a 2 dimensional data, as a nested arrays,\n// which is similar to matrix, however, unlike matrices,\n// each row may contain a different number of columns.\n// Given lst, and integer x, find integers x in the array,\n// and return array of arrays, [(x1, y1), (x2, y2) ...] such that\n// each array is a coordinate - (row, columns), starting with 0.\n// Sort coordinates initially by rows in ascending order.\n// Also, sort coordinates of the row by columns in descending order.\n// Examples:\n// >>> get_row([[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 1, 6], [1, 2, 3, 4, 5, 1]], 1)\n// [[0, 0], [1, 4], [1, 0], [2, 5], [2, 0]]\n// >>> get_row([], 1)\n// []\n// >>> get_row([[], [1], [1, 2, 3]], 3)\n// [[2, 2]]\nfunction get_row(lst, x){\n",
    entryPoint: "get_row",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = get_row;\n  assert.deepEqual(candidate([[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 1, 6], [1, 2, 3, 4, 5, 1]], 1),[[0, 0], [1, 4], [1, 0], [2, 5], [2, 0]]);\n  assert.deepEqual(candidate([[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]], 2),[[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);\n  assert.deepEqual(candidate([[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], [1, 1, 3, 4, 5, 6], [1, 2, 1, 4, 5, 6], [1, 2, 3, 1, 5, 6], [1, 2, 3, 4, 1, 6], [1, 2, 3, 4, 5, 1]], 1),[[0, 0], [1, 0], [2, 1], [2, 0], [3, 2], [3, 0], [4, 3], [4, 0], [5, 4], [5, 0], [6, 5], [6, 0]]);\n  assert.deepEqual(candidate([], 1),[]);\n  assert.deepEqual(candidate([[1]], 2),[]);\n  assert.deepEqual(candidate([[], [1], [1, 2, 3]], 3),[[2, 2]]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_440_find_adverb_position",
    domain: "javascript",
    title: "find_adverb_position",
    kind: "code",
    question:
      "//Write a function to find the first adverb and their positions in a given sentence.\nfunction find_adverb_position(text){\n",
    entryPoint: "find_adverb_position",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = find_adverb_position;\n  assert.deepEqual(candidate("clearly!! we can see the sky"),[0, 7, "clearly"]);\n  assert.deepEqual(candidate("seriously!! there are many roses"),[0, 9, "seriously"]);\n  assert.deepEqual(candidate("unfortunately!! sita is going to home"),[0, 13, "unfortunately"]);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_90_next_smallest",
    domain: "javascript",
    title: "next_smallest",
    kind: "code",
    question:
      "//You are given an array of integers.\n// Write a function next_smallest() that returns the 2nd smallest element of the array.\n// Return undefined if there is no such element.\n// >>> next_smallest([1, 2, 3, 4, 5])\n// 2\n// >>> next_smallest([5, 1, 4, 3, 2])\n// 2\n// >>> next_smallest([])\n// undefined\n// >>> next_smallest([1, 1])\n// undefined\nfunction next_smallest(lst){\n",
    entryPoint: "next_smallest",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = next_smallest;\n  assert.deepEqual(candidate([1, 2, 3, 4, 5]),2);\n  assert.deepEqual(candidate([5, 1, 4, 3, 2]),2);\n  assert.deepEqual(candidate([]),undefined);\n  assert.deepEqual(candidate([1, 1]),undefined);\n  assert.deepEqual(candidate([1, 1, 1, 1, 0]),1);\n  assert.deepEqual(candidate([1, 1]),undefined);\n  assert.deepEqual(candidate([-35, 34, 12, -45]),-35);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_448_cal_sum",
    domain: "javascript",
    title: "cal_sum",
    kind: "code",
    question:
      "//Write a function to calculate the sum of perrin numbers.\nfunction cal_sum(n){\n",
    entryPoint: "cal_sum",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = cal_sum;\n  assert.deepEqual(candidate(9),49);\n  assert.deepEqual(candidate(10),66);\n  assert.deepEqual(candidate(11),88);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_93_encode",
    domain: "javascript",
    title: "encode",
    kind: "code",
    question:
      '//Write a function that takes a message, and encodes in such a \n// way that it swaps case of all letters, replaces all vowels in \n// the message with the letter that appears 2 places ahead of that \n// vowel in the english alphabet. \n// Assume only letters. \n// Examples:\n// >>> encode("test")\n// "TGST"\n// >>> encode("This is a message")\n// "tHKS KS C MGSSCGG"\nfunction encode(message){\n',
    entryPoint: "encode",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = encode;\n  assert.deepEqual(candidate("TEST"),"tgst");\n  assert.deepEqual(candidate("Mudasir"),"mWDCSKR");\n  assert.deepEqual(candidate("YES"),"ygs");\n  assert.deepEqual(candidate("This is a message"),"tHKS KS C MGSSCGG");\n  assert.deepEqual(candidate("I DoNt KnOw WhAt tO WrItE"),"k dQnT kNqW wHcT Tq wRkTg");\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_457_Find_Min",
    domain: "javascript",
    title: "Find_Min",
    kind: "code",
    question:
      "//Write a JavaScript function to find the subarray having minimum length.\nfunction Find_Min(lst){\n",
    entryPoint: "Find_Min",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = Find_Min;\n  assert.deepEqual(candidate([[1], [1, 2], [1, 2, 3]]),[1]);\n  assert.deepEqual(candidate([[1, 1], [1, 1, 1], [1, 2, 7, 8]]),[1, 1]);\n  assert.deepEqual(candidate([["x"], ["x", "y"], ["x", "y", "z"]]),["x"]);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_96_count_up_to",
    domain: "javascript",
    title: "count_up_to",
    kind: "code",
    question:
      "//Implement a function that takes an non-negative integer and returns an array of the first n\n// integers that are prime numbers and less than n.\n// for example:\n// >>> count_up_to(5)\n// [2, 3]\n// >>> count_up_to(11)\n// [2, 3, 5, 7]\n// >>> count_up_to(0)\n// []\n// >>> count_up_to(20)\n// [2, 3, 5, 7, 11, 13, 17, 19]\n// >>> count_up_to(1)\n// []\n// >>> count_up_to(18)\n// [2, 3, 5, 7, 11, 13, 17]\nfunction count_up_to(n){\n",
    entryPoint: "count_up_to",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = count_up_to;\n  assert.deepEqual(candidate(5),[2, 3]);\n  assert.deepEqual(candidate(6),[2, 3, 5]);\n  assert.deepEqual(candidate(7),[2, 3, 5]);\n  assert.deepEqual(candidate(10),[2, 3, 5, 7]);\n  assert.deepEqual(candidate(0),[]);\n  assert.deepEqual(candidate(22),[2, 3, 5, 7, 11, 13, 17, 19]);\n  assert.deepEqual(candidate(1),[]);\n  assert.deepEqual(candidate(18),[2, 3, 5, 7, 11, 13, 17]);\n  assert.deepEqual(candidate(47),[2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43]);\n  assert.deepEqual(candidate(101),[2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_465_drop_empty",
    domain: "javascript",
    title: "drop_empty",
    kind: "code",
    question:
      "//Write a function to drop empty items from a given object.\nfunction drop_empty(dict1){\n",
    entryPoint: "drop_empty",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = drop_empty;\n  assert.deepEqual(candidate({"c1": "Red", "c2": "Green", "c3": undefined}),{"c1": "Red", "c2": "Green"});\n  assert.deepEqual(candidate({"c1": "Red", "c2": undefined, "c3": undefined}),{"c1": "Red"});\n  assert.deepEqual(candidate({"c1": undefined, "c2": "Green", "c3": undefined}),{"c2": "Green"});\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_100_make_a_pile",
    domain: "javascript",
    title: "make_a_pile",
    kind: "code",
    question:
      "//Given a positive integer n, you have to make a pile of n levels of stones.\n// The first level has n stones.\n// The number of stones in the next level is:\n// - the next odd number if n is odd.\n// - the next even number if n is even.\n// Return the number of stones in each level in an array, where element at index\n// i represents the number of stones in the level (i+1).\n// Examples:\n// >>> make_a_pile(3)\n// [3, 5, 7]\nfunction make_a_pile(n){\n",
    entryPoint: "make_a_pile",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = make_a_pile;\n  assert.deepEqual(candidate(3),[3, 5, 7]);\n  assert.deepEqual(candidate(4),[4, 6, 8, 10]);\n  assert.deepEqual(candidate(5),[5, 7, 9, 11, 13]);\n  assert.deepEqual(candidate(6),[6, 8, 10, 12, 14, 16]);\n  assert.deepEqual(candidate(8),[8, 10, 12, 14, 16, 18, 20, 22]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_477_is_lower",
    domain: "javascript",
    title: "is_lower",
    kind: "code",
    question:
      "//Write a JavaScript function to convert the given string to lower case.\nfunction is_lower(string){\n",
    entryPoint: "is_lower",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = is_lower;\n  assert.deepEqual(candidate("InValid"),"invalid");\n  assert.deepEqual(candidate("TruE"),"true");\n  assert.deepEqual(candidate("SenTenCE"),"sentence");\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_103_rounded_avg",
    domain: "javascript",
    title: "rounded_avg",
    kind: "code",
    question:
      '//You are given two positive integers n and m, and your task is to compute the\n// average of the integers from n through m (including n and m). \n// Round the answer to the nearest integer and convert that to binary.\n// If n is greater than m, return -1.\n// Example:\n// >>> rounded_avg(1, 5)\n// "0b11"\n// >>> rounded_avg(7, 5)\n// -1\n// >>> rounded_avg(10, 20)\n// "0b1111"\n// >>> rounded_avg(20, 33)\n// "0b11010"\nfunction rounded_avg(n, m){\n',
    entryPoint: "rounded_avg",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = rounded_avg;\n  assert.deepEqual(candidate(1, 5),"0b11");\n  assert.deepEqual(candidate(7, 13),"0b1010");\n  assert.deepEqual(candidate(964, 977),"0b1111001010");\n  assert.deepEqual(candidate(996, 997),"0b1111100100");\n  assert.deepEqual(candidate(560, 851),"0b1011000010");\n  assert.deepEqual(candidate(185, 546),"0b101101110");\n  assert.deepEqual(candidate(362, 496),"0b110101101");\n  assert.deepEqual(candidate(350, 902),"0b1001110010");\n  assert.deepEqual(candidate(197, 233),"0b11010111");\n  assert.deepEqual(candidate(7, 5),-1);\n  assert.deepEqual(candidate(5, 1),-1);\n  assert.deepEqual(candidate(5, 5),"0b101");\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_559_max_sub_array_sum",
    domain: "javascript",
    title: "max_sub_array_sum",
    kind: "code",
    question:
      "//Write a function to find the sum of the largest contiguous subarray in the given array.\nfunction max_sub_array_sum(a, size){\n",
    entryPoint: "max_sub_array_sum",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = max_sub_array_sum;\n  assert.deepEqual(candidate([-2, -3, 4, -1, -2, 1, 5, -3], 8),7);\n  assert.deepEqual(candidate([-3, -4, 5, -2, -3, 2, 6, -4], 8),8);\n  assert.deepEqual(candidate([-4, -5, 6, -3, -4, 3, 7, -5], 8),10);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_106_f",
    domain: "javascript",
    title: "f",
    kind: "code",
    question:
      "//Implement the function f that takes n as a parameter,\n// and returns an array of size n, such that the value of the element at index i is the factorial of i if i is even\n// or the sum of numbers from 1 to i otherwise.\n// i starts from 1.\n// the factorial of i is the multiplication of the numbers from 1 to i (1 * 2 * ... * i).\n// Example:\n// >>> f(5)\n// [1, 2, 6, 24, 15]\nfunction f(n){\n",
    entryPoint: "f",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = f;\n  assert.deepEqual(candidate(5),[1, 2, 6, 24, 15]);\n  assert.deepEqual(candidate(7),[1, 2, 6, 24, 15, 720, 28]);\n  assert.deepEqual(candidate(1),[1]);\n  assert.deepEqual(candidate(3),[1, 2, 6]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_569_sort_sublists",
    domain: "javascript",
    title: "sort_sublists",
    kind: "code",
    question:
      "//Write a function to sort each subarray of strings in a given array of arrays.\nfunction sort_sublists(list1){\n",
    entryPoint: "sort_sublists",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = sort_sublists;\n  assert.deepEqual(candidate([["green", "orange"], ["black", "white"], ["white", "black", "orange"]]),[["green", "orange"], ["black", "white"], ["black", "orange", "white"]]);\n  assert.deepEqual(candidate([["green", "orange"], ["black"], ["green", "orange"], ["white"]]),[["green", "orange"], ["black"], ["green", "orange"], ["white"]]);\n  assert.deepEqual(candidate([["a", "b"], ["d", "c"], ["g", "h"], ["f", "e"]]),[["a", "b"], ["c", "d"], ["g", "h"], ["e", "f"]]);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_109_move_one_ball",
    domain: "javascript",
    title: "move_one_ball",
    kind: "code",
    question:
      "//We have an array 'arr' of N integers arr[1], arr[2], ..., arr[N].The\n// numbers in the array will be randomly ordered. Your task is to determine if\n// it is possible to get an array sorted in non-decreasing order by performing \n// the following operation on the given array:\n// You are allowed to perform right shift operation any number of times.\n// One right shift operation means shifting all elements of the array by one\n// position in the right direction. The last element of the array will be moved to\n// the starting position in the array i.e. 0th index. \n// If it is possible to obtain the sorted array by performing the above operation\n// then return true else return false.\n// If the given array is empty then return true.\n// Note: The given array is guaranteed to have unique elements.\n// For Example:\n// >>> move_one_ball([3, 4, 5, 1, 2])\n// true\n// Explanation: By performin 2 right shift operations, non-decreasing order can\n// be achieved for the given array.\n// >>> move_one_ball([3, 5, 4, 1, 2])\n// false\n// Explanation:It is not possible to get non-decreasing order for the given\n// array by performing any number of right shift operations.\nfunction move_one_ball(arr){\n",
    entryPoint: "move_one_ball",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = move_one_ball;\n  assert.deepEqual(candidate([3, 4, 5, 1, 2]),true);\n  assert.deepEqual(candidate([3, 5, 10, 1, 2]),true);\n  assert.deepEqual(candidate([4, 3, 1, 2]),false);\n  assert.deepEqual(candidate([3, 5, 4, 1, 2]),false);\n  assert.deepEqual(candidate([]),true);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_580_extract_even",
    domain: "javascript",
    title: "extract_even",
    kind: "code",
    question:
      "//Write a function to remove uneven elements in the nested mixed array.\nfunction extract_even(test_tuple){\n",
    entryPoint: "extract_even",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = extract_even;\n  assert.deepEqual(candidate([4, 5, [7, 6, [2, 4]], 6, 8]),[4, [6, [2, 4]], 6, 8]);\n  assert.deepEqual(candidate([5, 6, [8, 7, [4, 8]], 7, 9]),[6, [8, [4, 8]]]);\n  assert.deepEqual(candidate([5, 6, [9, 8, [4, 6]], 8, 10]),[6, [8, [4, 6]], 8, 10]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_112_reverse_delete",
    domain: "javascript",
    title: "reverse_delete",
    kind: "code",
    question:
      '//Task\n// We are given two strings s and c, you have to deleted all the characters in s that are equal to any character in c\n// then check if the result string is palindrome.\n// A string is called palindrome if it reads the same backward as forward.\n// You should return an array containing the result string and true/false for the check.\n// Example\n// >>> reverse_delete("abcde", "ae")\n// ["bcd", false]\n// >>> reverse_delete("abcdef", "b")\n// ["acdef", false]\n// >>> reverse_delete("abcdedcba", "ab")\n// ["cdedc", true]\nfunction reverse_delete(s, c){\n',
    entryPoint: "reverse_delete",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = reverse_delete;\n  assert.deepEqual(candidate("abcde", "ae"),["bcd", false]);\n  assert.deepEqual(candidate("abcdef", "b"),["acdef", false]);\n  assert.deepEqual(candidate("abcdedcba", "ab"),["cdedc", true]);\n  assert.deepEqual(candidate("dwik", "w"),["dik", false]);\n  assert.deepEqual(candidate("a", "a"),["", true]);\n  assert.deepEqual(candidate("abcdedcba", ""),["abcdedcba", true]);\n  assert.deepEqual(candidate("abcdedcba", "v"),["abcdedcba", true]);\n  assert.deepEqual(candidate("vabba", "v"),["abba", true]);\n  assert.deepEqual(candidate("mamma", "mia"),["", true]);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_588_big_diff",
    domain: "javascript",
    title: "big_diff",
    kind: "code",
    question:
      "//Write a JavaScript function to find the difference between largest and smallest value in a given array.\nfunction big_diff(nums){\n",
    entryPoint: "big_diff",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = big_diff;\n  assert.deepEqual(candidate([1, 2, 3, 4]),3);\n  assert.deepEqual(candidate([4, 5, 12]),8);\n  assert.deepEqual(candidate([9, 2, 3]),7);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_116_sort_array",
    domain: "javascript",
    title: "sort_array",
    kind: "code",
    question:
      "//In this Kata, you have to sort an array of non-negative integers according to\n// number of ones in their binary representation in ascending order.\n// For similar number of ones, sort based on decimal value.\n// It must be implemented like this:\n// >>> sort_array([1, 5, 2, 3, 4])\n// [1, 2, 3, 4, 5]\n// >>> sort_array([-2, -3, -4, -5, -6])\n// [-6, -5, -4, -3, -2]\n// >>> sort_array([1, 0, 2, 3, 4])\n// [0, 1, 2, 3, 4]\nfunction sort_array(arr){\n",
    entryPoint: "sort_array",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = sort_array;\n  assert.deepEqual(candidate([1, 5, 2, 3, 4]),[1, 2, 4, 3, 5]);\n  assert.deepEqual(candidate([-2, -3, -4, -5, -6]),[-4, -2, -6, -5, -3]);\n  assert.deepEqual(candidate([1, 0, 2, 3, 4]),[0, 1, 2, 4, 3]);\n  assert.deepEqual(candidate([]),[]);\n  assert.deepEqual(candidate([2, 5, 77, 4, 5, 3, 5, 7, 2, 3, 4]),[2, 2, 4, 4, 3, 3, 5, 5, 5, 7, 77]);\n  assert.deepEqual(candidate([3, 6, 44, 12, 32, 5]),[32, 3, 5, 6, 12, 44]);\n  assert.deepEqual(candidate([2, 4, 8, 16, 32]),[2, 4, 8, 16, 32]);\n  assert.deepEqual(candidate([2, 4, 8, 16, 32]),[2, 4, 8, 16, 32]);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_598_armstrong_number",
    domain: "javascript",
    title: "armstrong_number",
    kind: "code",
    question:
      "//Write a function to check whether the given number is armstrong or not.\nfunction armstrong_number(number){\n",
    entryPoint: "armstrong_number",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = armstrong_number;\n  assert.deepEqual(candidate(153),true);\n  assert.deepEqual(candidate(259),false);\n  assert.deepEqual(candidate(4458),false);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_119_match_parens",
    domain: "javascript",
    title: "match_parens",
    kind: "code",
    question:
      "//You are given an array of two strings, both strings consist of open\n// parentheses '(' or close parentheses ')' only.\n// Your job is to check if it is possible to concatenate the two strings in\n// some order, that the resulting string will be good.\n// A string S is considered to be good if and only if all parentheses in S\n// are balanced. For example: the string '(())()' is good, while the string\n// '())' is not.\n// Return 'Yes' if there's a way to make a good string, and return 'No' otherwise.\n// Examples:\n// >>> match_parens([\"()(\", \")\"])\n// \"Yes\"\n// >>> match_parens([\")\", \")\"])\n// \"No\"\nfunction match_parens(lst){\n",
    entryPoint: "match_parens",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = match_parens;\n  assert.deepEqual(candidate(["()(", ")"]),"Yes");\n  assert.deepEqual(candidate([")", ")"]),"No");\n  assert.deepEqual(candidate(["(()(())", "())())"]),"No");\n  assert.deepEqual(candidate([")())", "(()()("]),"Yes");\n  assert.deepEqual(candidate(["(())))", "(()())(("]),"Yes");\n  assert.deepEqual(candidate(["()", "())"]),"No");\n  assert.deepEqual(candidate(["(()(", "()))()"]),"Yes");\n  assert.deepEqual(candidate(["((((", "((())"]),"No");\n  assert.deepEqual(candidate([")(()", "(()("]),"No");\n  assert.deepEqual(candidate([")(", ")("]),"No");\n  assert.deepEqual(candidate(["(", ")"]),"Yes");\n  assert.deepEqual(candidate([")", "("]),"Yes");\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_607_find_literals",
    domain: "javascript",
    title: "find_literals",
    kind: "code",
    question:
      "//Write a function to search a string for a regex pattern. The function should return the matching subtring, a start index and an end index.\nfunction find_literals(text, pattern){\n",
    entryPoint: "find_literals",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = find_literals;\n  assert.deepEqual(candidate("The quick brown fox jumps over the lazy dog.", "fox"),["fox", 16, 19]);\n  assert.deepEqual(candidate("Its been a very crazy procedure right", "crazy"),["crazy", 16, 21]);\n  assert.deepEqual(candidate("Hardest choices required strongest will", "will"),["will", 35, 39]);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_122_add_elements",
    domain: "javascript",
    title: "add_elements",
    kind: "code",
    question:
      "//Given a non-empty array of integers arr and an integer k, return\n// the sum of the elements with at most two digits from the first k elements of arr.\n// Example:\n// >>> add_elements([111, 21, 3, 4000, 5, 6, 7, 8, 9], 4)\n// 24\n// Constraints:\n// 1. 1 <= len(arr) <= 100\n// 2. 1 <= k <= len(arr)\nfunction add_elements(arr, k){\n",
    entryPoint: "add_elements",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = add_elements;\n  assert.deepEqual(candidate([1, -2, -3, 41, 57, 76, 87, 88, 99], 3),-4);\n  assert.deepEqual(candidate([111, 121, 3, 4000, 5, 6], 2),0);\n  assert.deepEqual(candidate([11, 21, 3, 90, 5, 6, 7, 8, 9], 4),125);\n  assert.deepEqual(candidate([111, 21, 3, 4000, 5, 6, 7, 8, 9], 4),24);\n  assert.deepEqual(candidate([1], 1),1);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_617_min_Jumps",
    domain: "javascript",
    title: "min_Jumps",
    kind: "code",
    question:
      "//Write a function to check for the number of jumps required of given length to reach a point of form (d, 0) from origin in a 2d plane.\nfunction min_Jumps(steps, d){\n",
    entryPoint: "min_Jumps",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = min_Jumps;\n  assert.deepEqual(candidate([3, 4], 11),3.5);\n  assert.deepEqual(candidate([3, 4], 0),0);\n  assert.deepEqual(candidate([11, 14], 11),1);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_125_split_words",
    domain: "javascript",
    title: "split_words",
    kind: "code",
    question:
      '//Given a string of words, return an array of words split on whitespace, if no whitespaces exists in the text you\n// should split on commas \',\' if no commas exists you should return the number of lower-case letters with odd order in the\n// alphabet, ord(\'a\') = 0, ord(\'b\') = 1, ... ord(\'z\') = 25\n// Examples\n// >>> split_words("Hello world!")\n// ["Hello", "world!"]\n// >>> split_words("Hello,world!")\n// ["Hello", "world!"]\n// >>> split_words("abcdef")\n// 3\nfunction split_words(txt){\n',
    entryPoint: "split_words",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = split_words;\n  assert.deepEqual(candidate("Hello world!"),["Hello", "world!"]);\n  assert.deepEqual(candidate("Hello,world!"),["Hello", "world!"]);\n  assert.deepEqual(candidate("Hello world,!"),["Hello", "world,!"]);\n  assert.deepEqual(candidate("Hello,Hello,world !"),["Hello,Hello,world", "!"]);\n  assert.deepEqual(candidate("abcdef"),3);\n  assert.deepEqual(candidate("aaabb"),2);\n  assert.deepEqual(candidate("aaaBb"),1);\n  assert.deepEqual(candidate(""),0);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_627_find_First_Missing",
    domain: "javascript",
    title: "find_First_Missing",
    kind: "code",
    question:
      "//Write a JavaScript function to find the smallest missing number from a sorted array of natural numbers.\nfunction find_First_Missing(array){\n",
    entryPoint: "find_First_Missing",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = find_First_Missing;\n  assert.deepEqual(candidate([0, 1, 2, 3]),4);\n  assert.deepEqual(candidate([0, 1, 2, 6, 9]),3);\n  assert.deepEqual(candidate([2, 3, 5, 8, 9]),0);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_128_prod_signs",
    domain: "javascript",
    title: "prod_signs",
    kind: "code",
    question:
      "//You are given an array arr of integers and you need to return\n// sum of magnitudes of integers multiplied by product of all signs\n// of each number in the array, represented by 1, -1 or 0.\n// Note: return undefined for empty arr.\n// Example:\n// >>> prod_signs([1, 2, 2, -4])\n// 9\n// >>> prod_signs([0, 1])\n// 0\n// >>> prod_signs([])\n// undefined\nfunction prod_signs(arr){\n",
    entryPoint: "prod_signs",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = prod_signs;\n  assert.deepEqual(candidate([1, 2, 2, -4]),-9);\n  assert.deepEqual(candidate([0, 1]),0);\n  assert.deepEqual(candidate([1, 1, 1, 2, 3, -1, 1]),-10);\n  assert.deepEqual(candidate([]),undefined);\n  assert.deepEqual(candidate([2, 4, 1, 2, -1, -1, 9]),20);\n  assert.deepEqual(candidate([-1, 1, -1, 1]),4);\n  assert.deepEqual(candidate([-1, 1, 1, 1]),-4);\n  assert.deepEqual(candidate([-1, 1, 1, 0]),0);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_637_noprofit_noloss",
    domain: "javascript",
    title: "noprofit_noloss",
    kind: "code",
    question:
      "//Write a function to check whether the given amount has no profit and no loss\nfunction noprofit_noloss(actual_cost, sale_amount){\n",
    entryPoint: "noprofit_noloss",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = noprofit_noloss;\n  assert.deepEqual(candidate(1500, 1200),false);\n  assert.deepEqual(candidate(100, 100),true);\n  assert.deepEqual(candidate(2000, 5000),false);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_132_is_nested",
    domain: "javascript",
    title: "is_nested",
    kind: "code",
    question:
      '//Create a function that takes a string as input which contains only square brackets.\n// The function should return true if and only if there is a valid subsequence of brackets \n// where at least one bracket in the subsequence is nested.\n// >>> is_nested("[[]]")\n// true\n// >>> is_nested("[]]]]]]][[[[[]")\n// false\n// >>> is_nested("[][]")\n// false\n// >>> is_nested("[]")\n// false\n// >>> is_nested("[[][]]")\n// true\n// >>> is_nested("[[]][[")\n// true\nfunction is_nested(string){\n',
    entryPoint: "is_nested",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = is_nested;\n  assert.deepEqual(candidate("[[]]"),true);\n  assert.deepEqual(candidate("[]]]]]]][[[[[]"),false);\n  assert.deepEqual(candidate("[][]"),false);\n  assert.deepEqual(candidate("[]"),false);\n  assert.deepEqual(candidate("[[[[]]]]"),true);\n  assert.deepEqual(candidate("[]]]]]]]]]]"),false);\n  assert.deepEqual(candidate("[][][[]]"),true);\n  assert.deepEqual(candidate("[[]"),false);\n  assert.deepEqual(candidate("[]]"),false);\n  assert.deepEqual(candidate("[[]][["),true);\n  assert.deepEqual(candidate("[[][]]"),true);\n  assert.deepEqual(candidate(""),false);\n  assert.deepEqual(candidate("[[[[[[[["),false);\n  assert.deepEqual(candidate("]]]]]]]]"),false);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_721_maxAverageOfPath",
    domain: "javascript",
    title: "maxAverageOfPath",
    kind: "code",
    question:
      "//Given a square matrix of size N*N given as an array of arrays, where each cell is associated with a specific cost. A path is defined as a specific sequence of cells that starts from the top-left cell move only right or down and ends on bottom right cell. We want to find a path with the maximum average over all existing paths. Average is computed as total cost divided by the number of cells visited in the path.\nfunction maxAverageOfPath(cost){\n",
    entryPoint: "maxAverageOfPath",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = maxAverageOfPath;\n  assert.deepEqual(candidate([[1, 2, 3], [6, 5, 4], [7, 3, 9]]),5.2);\n  assert.deepEqual(candidate([[2, 3, 4], [7, 6, 5], [8, 4, 10]]),6.2);\n  assert.deepEqual(candidate([[3, 4, 5], [8, 7, 6], [9, 5, 11]]),7.2);\n  assert.deepEqual(candidate([[1, 2, 3], [4, 5, 6], [7, 8, 9]]),5.8);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_135_can_arrange",
    domain: "javascript",
    title: "can_arrange",
    kind: "code",
    question:
      "//Create a function which returns the largest index of an element which\n// is not greater than or equal to the element immediately preceding it. If\n// no such element exists then return -1. The given array will not contain\n// duplicate values.\n// Examples:\n// >>> can_arrange([1, 2, 4, 3, 5])\n// 3\n// >>> can_arrange([1, 2, 3])\n// -1\nfunction can_arrange(arr){\n",
    entryPoint: "can_arrange",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = can_arrange;\n  assert.deepEqual(candidate([1, 2, 4, 3, 5]),3);\n  assert.deepEqual(candidate([1, 2, 4, 5]),-1);\n  assert.deepEqual(candidate([1, 4, 2, 5, 6, 7, 8, 9, 10]),2);\n  assert.deepEqual(candidate([4, 8, 5, 7, 3]),4);\n  assert.deepEqual(candidate([]),-1);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_732_replace_specialchar",
    domain: "javascript",
    title: "replace_specialchar",
    kind: "code",
    question:
      "//Write a function to replace all occurrences of spaces, commas, or dots with a colon.\nfunction replace_specialchar(text){\n",
    entryPoint: "replace_specialchar",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = replace_specialchar;\n  assert.deepEqual(candidate("Python language, Programming language."),"Python:language::Programming:language:");\n  assert.deepEqual(candidate("a b c,d e f"),"a:b:c:d:e:f");\n  assert.deepEqual(candidate("ram reshma,ram rahim"),"ram:reshma:ram:rahim");\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_138_is_equal_to_sum_even",
    domain: "javascript",
    title: "is_equal_to_sum_even",
    kind: "code",
    question:
      "//Evaluate whether the given number n can be written as the sum of exactly 4 positive even numbers\n// Example\n// >>> is_equal_to_sum_even(4)\n// false\n// >>> is_equal_to_sum_even(6)\n// false\n// >>> is_equal_to_sum_even(8)\n// true\nfunction is_equal_to_sum_even(n){\n",
    entryPoint: "is_equal_to_sum_even",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = is_equal_to_sum_even;\n  assert.deepEqual(candidate(4),false);\n  assert.deepEqual(candidate(6),false);\n  assert.deepEqual(candidate(8),true);\n  assert.deepEqual(candidate(10),true);\n  assert.deepEqual(candidate(11),false);\n  assert.deepEqual(candidate(12),true);\n  assert.deepEqual(candidate(13),false);\n  assert.deepEqual(candidate(16),true);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_739_find_Index",
    domain: "javascript",
    title: "find_Index",
    kind: "code",
    question:
      "//Write a JavaScript function to find the index of smallest triangular number with n digits. https://www.geeksforgeeks.org/index-of-smallest-triangular-number-with-n-digits/\nfunction find_Index(n){\n",
    entryPoint: "find_Index",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = find_Index;\n  assert.deepEqual(candidate(2),4);\n  assert.deepEqual(candidate(3),14);\n  assert.deepEqual(candidate(4),45);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_141_file_name_check",
    domain: "javascript",
    title: "file_name_check",
    kind: "code",
    question:
      "//Create a function which takes a string representing a file's name, and returns\n// 'Yes' if the the file's name is valid, and returns 'No' otherwise.\n// A file's name is considered to be valid if and only if all the following conditions \n// are met:\n// - There should not be more than three digits ('0'-'9') in the file's name.\n// - The file's name contains exactly one dot '.'\n// - The substring before the dot should not be empty, and it starts with a letter from \n// the latin alphapet ('a'-'z' and 'A'-'Z').\n// - The substring after the dot should be one of these: ['txt', 'exe', 'dll']\n// Examples:\n// >>> file_name_check(\"example.txt\")\n// \"Yes\"\n// >>> file_name_check(\"1example.dll\")\n// \"No\"\nfunction file_name_check(file_name){\n",
    entryPoint: "file_name_check",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = file_name_check;\n  assert.deepEqual(candidate("example.txt"),"Yes");\n  assert.deepEqual(candidate("1example.dll"),"No");\n  assert.deepEqual(candidate("s1sdf3.asd"),"No");\n  assert.deepEqual(candidate("K.dll"),"Yes");\n  assert.deepEqual(candidate("MY16FILE3.exe"),"Yes");\n  assert.deepEqual(candidate("His12FILE94.exe"),"No");\n  assert.deepEqual(candidate("_Y.txt"),"No");\n  assert.deepEqual(candidate("?aREYA.exe"),"No");\n  assert.deepEqual(candidate("/this_is_valid.dll"),"No");\n  assert.deepEqual(candidate("this_is_valid.wow"),"No");\n  assert.deepEqual(candidate("this_is_valid.txt"),"Yes");\n  assert.deepEqual(candidate("this_is_valid.txtexe"),"No");\n  assert.deepEqual(candidate("#this2_i4s_5valid.ten"),"No");\n  assert.deepEqual(candidate("@this1_is6_valid.exe"),"No");\n  assert.deepEqual(candidate("this_is_12valid.6exe4.txt"),"No");\n  assert.deepEqual(candidate("all.exe.txt"),"No");\n  assert.deepEqual(candidate("I563_No.exe"),"Yes");\n  assert.deepEqual(candidate("Is3youfault.txt"),"Yes");\n  assert.deepEqual(candidate("no_one#knows.dll"),"Yes");\n  assert.deepEqual(candidate("1I563_Yes3.exe"),"No");\n  assert.deepEqual(candidate("I563_Yes3.txtt"),"No");\n  assert.deepEqual(candidate("final..txt"),"No");\n  assert.deepEqual(candidate("final132"),"No");\n  assert.deepEqual(candidate("_f4indsartal132."),"No");\n  assert.deepEqual(candidate(".txt"),"No");\n  assert.deepEqual(candidate("s."),"No");\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_747_lcs_of_three",
    domain: "javascript",
    title: "lcs_of_three",
    kind: "code",
    question:
      "//Write a function to find the longest common subsequence for the given three string sequence. https://www.geeksforgeeks.org/lcs-longest-common-subsequence-three-strings/\nfunction lcs_of_three(X, Y, Z){\n",
    entryPoint: "lcs_of_three",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = lcs_of_three;\n  assert.deepEqual(candidate("AGGT12", "12TXAYB", "12XBA"),2);\n  assert.deepEqual(candidate("Reels", "Reelsfor", "ReelsforReels"),5);\n  assert.deepEqual(candidate("abcd1e2", "bc12ea", "bd1ea"),3);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_144_simplify",
    domain: "javascript",
    title: "simplify",
    kind: "code",
    question:
      '//Your task is to implement a function that will simplify the expression\n// x * n. The function returns true if x * n evaluates to a whole number and false\n// otherwise. Both x and n, are string representation of a fraction, and have the following format,\n// <numerator>/<denominator> where both numerator and denominator are positive whole numbers.\n// You can assume that x, and n are valid fractions, and do not have zero as denominator.\n// >>> simplify("1/5", "5/1")\n// true\n// >>> simplify("1/6", "2/1")\n// false\n// >>> simplify("7/10", "10/2")\n// false\nfunction simplify(x, n){\n',
    entryPoint: "simplify",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = simplify;\n  assert.deepEqual(candidate("1/5", "5/1"),true);\n  assert.deepEqual(candidate("1/6", "2/1"),false);\n  assert.deepEqual(candidate("5/1", "3/1"),true);\n  assert.deepEqual(candidate("7/10", "10/2"),false);\n  assert.deepEqual(candidate("2/10", "50/10"),true);\n  assert.deepEqual(candidate("7/2", "4/2"),true);\n  assert.deepEqual(candidate("11/6", "6/1"),true);\n  assert.deepEqual(candidate("2/3", "5/2"),false);\n  assert.deepEqual(candidate("5/2", "3/5"),false);\n  assert.deepEqual(candidate("2/4", "8/4"),true);\n  assert.deepEqual(candidate("2/4", "4/2"),true);\n  assert.deepEqual(candidate("1/5", "5/1"),true);\n  assert.deepEqual(candidate("1/5", "1/5"),false);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_755_second_smallest",
    domain: "javascript",
    title: "second_smallest",
    kind: "code",
    question:
      "//Write a function to find the second smallest number in an array.\nfunction second_smallest(numbers){\n",
    entryPoint: "second_smallest",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = second_smallest;\n  assert.deepEqual(candidate([1, 2, -8, -2, 0, -2]),-2);\n  assert.deepEqual(candidate([1, 1, -0.5, 0, 2, -2, -2]),-0.5);\n  assert.deepEqual(candidate([2, 2]),undefined);\n  assert.deepEqual(candidate([2, 2, 2]),undefined);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_148_bf",
    domain: "javascript",
    title: "bf",
    kind: "code",
    question:
      '//There are eight planets in our solar system: the closerst to the Sun \n// is Mercury, the next one is Venus, then Earth, Mars, Jupiter, Saturn, \n// Uranus, Neptune.\n// Write a function that takes two planet names as strings planet1 and planet2. \n// The function should return an array containing all planets whose orbits are \n// located between the orbit of planet1 and the orbit of planet2, sorted by \n// the proximity to the sun. \n// The function should return an empty array if planet1 or planet2\n// are not correct planet names. \n// Examples\n// >>> bf("Jupiter", "Neptune")\n// ["Saturn", "Uranus"]\n// >>> bf("Earth", "Mercury")\n// "Venus"\n// >>> bf("Mercury", "Uranus")\n// ["Venus", "Earth", "Mars", "Jupiter", "Saturn"]\nfunction bf(planet1, planet2){\n',
    entryPoint: "bf",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = bf;\n  assert.deepEqual(candidate("Jupiter", "Neptune"),["Saturn", "Uranus"]);\n  assert.deepEqual(candidate("Earth", "Mercury"),["Venus"]);\n  assert.deepEqual(candidate("Mercury", "Uranus"),["Venus", "Earth", "Mars", "Jupiter", "Saturn"]);\n  assert.deepEqual(candidate("Neptune", "Venus"),["Earth", "Mars", "Jupiter", "Saturn", "Uranus"]);\n  assert.deepEqual(candidate("Earth", "Earth"),[]);\n  assert.deepEqual(candidate("Mars", "Earth"),[]);\n  assert.deepEqual(candidate("Jupiter", "Makemake"),[]);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_765_is_polite",
    domain: "javascript",
    title: "is_polite",
    kind: "code",
    question:
      "//Write a function to find nth polite number. geeksforgeeks.org/n-th-polite-number/\nfunction is_polite(n){\n",
    entryPoint: "is_polite",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = is_polite;\n  assert.deepEqual(candidate(7),11);\n  assert.deepEqual(candidate(4),7);\n  assert.deepEqual(candidate(9),13);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_151_double_the_difference",
    domain: "javascript",
    title: "double_the_difference",
    kind: "code",
    question:
      "//Given an array of numbers, return the sum of squares of the numbers\n// in the array that are odd. Ignore numbers that are negative or not integers.\n// >>> double_the_difference([1, 3, 2, 0])\n// 10\n// >>> double_the_difference([-1, -2, 0])\n// 0\n// >>> double_the_difference([9, -2])\n// 81\n// >>> double_the_difference([0])\n// 0\n// If the input array is empty, return 0.\nfunction double_the_difference(lst){\n",
    entryPoint: "double_the_difference",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = double_the_difference;\n  assert.deepEqual(candidate([]),0);\n  assert.deepEqual(candidate([5.0, 4.0]),25);\n  assert.deepEqual(candidate([0.1, 0.2, 0.3]),0);\n  assert.deepEqual(candidate([-10.0, -20.0, -30.0]),0);\n  assert.deepEqual(candidate([-1.0, -2.0, 8.0]),0);\n  assert.deepEqual(candidate([0.2, 3.0, 5.0]),34);\n  assert.deepEqual(candidate([-9.0, -7.0, -5.0, -3.0, -1.0, 1.0, 3.0, 5.0, 7.0, 9.0]),165);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_775_odd_position",
    domain: "javascript",
    title: "odd_position",
    kind: "code",
    question:
      "//Write a JavaScript function to check whether every odd index contains odd numbers of a given array.\nfunction odd_position(nums){\n",
    entryPoint: "odd_position",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = odd_position;\n  assert.deepEqual(candidate([2, 1, 4, 3, 6, 7, 6, 3]),true);\n  assert.deepEqual(candidate([4, 1, 2]),true);\n  assert.deepEqual(candidate([1, 2, 3]),false);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_154_cycpattern_check",
    domain: "javascript",
    title: "cycpattern_check",
    kind: "code",
    question:
      '//You are given 2 words. You need to return true if the second word or any of its rotations is a substring in the first word\n// >>> cycpattern_check("abcd", "abd")\n// false\n// >>> cycpattern_check("hello", "ell")\n// true\n// >>> cycpattern_check("whassup", "psus")\n// false\n// >>> cycpattern_check("abab", "baa")\n// true\n// >>> cycpattern_check("efef", "eeff")\n// false\n// >>> cycpattern_check("himenss", "simen")\n// true\nfunction cycpattern_check(a, b){\n',
    entryPoint: "cycpattern_check",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = cycpattern_check;\n  assert.deepEqual(candidate("xyzw", "xyw"),false);\n  assert.deepEqual(candidate("yello", "ell"),true);\n  assert.deepEqual(candidate("whattup", "ptut"),false);\n  assert.deepEqual(candidate("efef", "fee"),true);\n  assert.deepEqual(candidate("abab", "aabb"),false);\n  assert.deepEqual(candidate("winemtt", "tinem"),true);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_784_mul_even_odd",
    domain: "javascript",
    title: "mul_even_odd",
    kind: "code",
    question:
      "//Write a function to find the product of first even and odd number of a given array.\nfunction mul_even_odd(list1){\n",
    entryPoint: "mul_even_odd",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = mul_even_odd;\n  assert.deepEqual(candidate([1, 3, 5, 7, 4, 1, 6, 8]),4);\n  assert.deepEqual(candidate([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),2);\n  assert.deepEqual(candidate([1, 5, 7, 9, 10]),10);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_157_right_angle_triangle",
    domain: "javascript",
    title: "right_angle_triangle",
    kind: "code",
    question:
      "//Given the lengths of the three sides of a triangle. Return true if the three\n// sides form a right-angled triangle, false otherwise.\n// A right-angled triangle is a triangle in which one angle is right angle or \n// 90 degree.\n// Example:\n// >>> right_angle_triangle(3, 4, 5)\n// true\n// >>> right_angle_triangle(1, 2, 3)\n// false\nfunction right_angle_triangle(a, b, c){\n",
    entryPoint: "right_angle_triangle",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = right_angle_triangle;\n  assert.deepEqual(candidate(3, 4, 5),true);\n  assert.deepEqual(candidate(1, 2, 3),false);\n  assert.deepEqual(candidate(10, 6, 8),true);\n  assert.deepEqual(candidate(2, 2, 2),false);\n  assert.deepEqual(candidate(7, 24, 25),true);\n  assert.deepEqual(candidate(10, 5, 7),false);\n  assert.deepEqual(candidate(5, 12, 13),true);\n  assert.deepEqual(candidate(15, 8, 17),true);\n  assert.deepEqual(candidate(48, 55, 73),true);\n  assert.deepEqual(candidate(1, 1, 1),false);\n  assert.deepEqual(candidate(2, 2, 10),false);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_793_last",
    domain: "javascript",
    title: "last",
    kind: "code",
    question:
      "//Write a JavaScript function to find the last position of an element in a sorted array.\nfunction last(arr, x){\n",
    entryPoint: "last",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = last;\n  assert.deepEqual(candidate([1, 2, 3], 1),0);\n  assert.deepEqual(candidate([1, 1, 1, 2, 3, 4], 1),2);\n  assert.deepEqual(candidate([2, 3, 2, 3, 6, 8, 9], 3),3);\n}\n\ntest();",
    answer: "tests pass",
  },
  {
    source: "HumanEval",
    id: "HumanEval_160_do_algebra",
    domain: "javascript",
    title: "do_algebra",
    kind: "code",
    question:
      "//Given two arrays operator, and operand. The first array has basic algebra operations, and \n// the second array is an array of integers. Use the two given arrays to build the algebric \n// expression and return the evaluation of this expression.\n// The basic algebra operations:\n// Addition ( + ) \n// Subtraction ( - ) \n// Multiplication ( * ) \n// Floor division ( // ) \n// Exponentiation ( ** ) \n// Example:\n// operator['+', '*', '-']\n// array = [2, 3, 4, 5]\n// result = 2 + 3 * 4 - 5\n// => result = 9\n// Note:\n// The length of operator array is equal to the length of operand array minus one.\n// Operand is an array of of non-negative integers.\n// Operator array has at least one operator, and operand array has at least two operands.\nfunction do_algebra(operator, operand){\n",
    entryPoint: "do_algebra",
    tests:
      'const assert = require(\'node:assert\');\n\n\nfunction test() {\n  let candidate = do_algebra;\n  assert.deepEqual(candidate(["**", "*", "+"], [2, 3, 4, 5]),37);\n  assert.deepEqual(candidate(["+", "*", "-"], [2, 3, 4, 5]),9);\n  assert.deepEqual(candidate(["//", "*"], [7, 3, 4]),8);\n}\n\ntest();',
    answer: "tests pass",
  },
  {
    source: "MBPP",
    id: "mbpp_802_count_rotation",
    domain: "javascript",
    title: "count_rotation",
    kind: "code",
    question:
      "//Write a JavaScript function to count the number of rotations required to generate a sorted array. https://www.geeksforgeeks.org/count-of-rotations-required-to-generate-a-sorted-array/\nfunction count_rotation(arr){\n",
    entryPoint: "count_rotation",
    tests:
      "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = count_rotation;\n  assert.deepEqual(candidate([3, 2, 1]),1);\n  assert.deepEqual(candidate([4, 5, 1, 2, 3]),2);\n  assert.deepEqual(candidate([7, 8, 9, 1, 2, 3]),3);\n  assert.deepEqual(candidate([1, 2, 3]),0);\n  assert.deepEqual(candidate([1, 3, 2]),2);\n}\n\ntest();",
    answer: "tests pass",
  },
];
