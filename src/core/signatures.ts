import type { TypeInfo } from './types';

export interface FunctionSignature {
  name: string;
  retType: TypeInfo;
  params: TypeInfo[];
  /** Number of required arguments. For variadic functions this excludes the trailing `...`. */
  minArgs: number;
  variadic: boolean;
  /** VS Code snippet syntax; placeholders use ${1:...}. */
  snippet: string;
}

const intType: TypeInfo = { base: 'int', ptr: 0 };
const charPtr: TypeInfo = { base: 'char', ptr: 1 };
const constCharPtr: TypeInfo = { base: 'char', ptr: 1, const: true };
const voidPtr: TypeInfo = { base: 'void', ptr: 1 };
const constVoidPtr: TypeInfo = { base: 'void', ptr: 1, const: true };
// size_t is unsigned long on the Linux/64-bit targets this plugin assumes.
const sizeType: TypeInfo = { base: 'ulong', ptr: 0 };
// FILE * is outside the built-in scalar/string knowledge; keep it opaque.
const filePtr: TypeInfo = { base: 'unknown', ptr: 1 };

export const SIGNATURES: readonly FunctionSignature[] = [
  {
    name: 'printf',
    retType: intType,
    params: [constCharPtr],
    minArgs: 1,
    variadic: true,
    snippet: 'printf("${1:%d}\\n", ${2:});',
  },
  {
    name: 'fprintf',
    retType: intType,
    params: [filePtr, constCharPtr],
    minArgs: 2,
    variadic: true,
    snippet: 'fprintf(${1:stderr}, "${2:%d}\\n", ${3:});',
  },
  {
    name: 'sprintf',
    retType: intType,
    params: [charPtr, constCharPtr],
    minArgs: 2,
    variadic: true,
    snippet: 'sprintf(${1:buf}, "${2:%d}", ${3:});',
  },
  {
    name: 'snprintf',
    retType: intType,
    params: [charPtr, sizeType, constCharPtr],
    minArgs: 3,
    variadic: true,
    snippet: 'snprintf(${1:buf}, ${2:sizeof(buf)}, "${3:%d}", ${4:});',
  },
  {
    name: 'scanf',
    retType: intType,
    params: [constCharPtr],
    minArgs: 1,
    variadic: true,
    snippet: 'scanf("${1:%d}", ${2:&var});',
  },
  {
    name: 'fscanf',
    retType: intType,
    params: [filePtr, constCharPtr],
    minArgs: 2,
    variadic: true,
    snippet: 'fscanf(${1:stdin}, "${2:%d}", ${3:&var});',
  },
  {
    name: 'sscanf',
    retType: intType,
    params: [constCharPtr, constCharPtr],
    minArgs: 2,
    variadic: true,
    snippet: 'sscanf(${1:str}, "${2:%d}", ${3:&var});',
  },
  {
    name: 'gets',
    retType: charPtr,
    params: [charPtr],
    minArgs: 1,
    variadic: false,
    snippet: 'gets(${1:buf});',
  },
  {
    name: 'fgets',
    retType: charPtr,
    params: [charPtr, intType, filePtr],
    minArgs: 3,
    variadic: false,
    snippet: 'fgets(${1:buf}, ${2:sizeof(buf)}, ${3:stdin});',
  },
  {
    name: 'puts',
    retType: intType,
    params: [constCharPtr],
    minArgs: 1,
    variadic: false,
    snippet: 'puts(${1:str});',
  },
  {
    name: 'fputs',
    retType: intType,
    params: [constCharPtr, filePtr],
    minArgs: 2,
    variadic: false,
    snippet: 'fputs(${1:str}, ${2:stdout});',
  },
  {
    name: 'putchar',
    retType: intType,
    params: [intType],
    minArgs: 1,
    variadic: false,
    snippet: 'putchar(${1:ch});',
  },
  {
    name: 'getchar',
    retType: intType,
    params: [],
    minArgs: 0,
    variadic: false,
    snippet: 'getchar()',
  },
  {
    name: 'strlen',
    retType: sizeType,
    params: [constCharPtr],
    minArgs: 1,
    variadic: false,
    snippet: 'strlen(${1:str})',
  },
  {
    name: 'strcpy',
    retType: charPtr,
    params: [charPtr, constCharPtr],
    minArgs: 2,
    variadic: false,
    snippet: 'strcpy(${1:dest}, ${2:src});',
  },
  {
    name: 'strncpy',
    retType: charPtr,
    params: [charPtr, constCharPtr, sizeType],
    minArgs: 3,
    variadic: false,
    snippet: 'strncpy(${1:dest}, ${2:src}, ${3:n});',
  },
  {
    name: 'strcat',
    retType: charPtr,
    params: [charPtr, constCharPtr],
    minArgs: 2,
    variadic: false,
    snippet: 'strcat(${1:dest}, ${2:src});',
  },
  {
    name: 'strncat',
    retType: charPtr,
    params: [charPtr, constCharPtr, sizeType],
    minArgs: 3,
    variadic: false,
    snippet: 'strncat(${1:dest}, ${2:src}, ${3:n});',
  },
  {
    name: 'strcmp',
    retType: intType,
    params: [constCharPtr, constCharPtr],
    minArgs: 2,
    variadic: false,
    snippet: 'strcmp(${1:a}, ${2:b})',
  },
  {
    name: 'strncmp',
    retType: intType,
    params: [constCharPtr, constCharPtr, sizeType],
    minArgs: 3,
    variadic: false,
    snippet: 'strncmp(${1:a}, ${2:b}, ${3:n})',
  },
  {
    name: 'strchr',
    retType: charPtr,
    params: [constCharPtr, intType],
    minArgs: 2,
    variadic: false,
    snippet: 'strchr(${1:str}, ${2:ch})',
  },
  {
    name: 'strstr',
    retType: charPtr,
    params: [constCharPtr, constCharPtr],
    minArgs: 2,
    variadic: false,
    snippet: 'strstr(${1:haystack}, ${2:needle})',
  },
  {
    name: 'memset',
    retType: voidPtr,
    params: [voidPtr, intType, sizeType],
    minArgs: 3,
    variadic: false,
    snippet: 'memset(${1:dest}, ${2:0}, ${3:n});',
  },
  {
    name: 'memcpy',
    retType: voidPtr,
    params: [voidPtr, constVoidPtr, sizeType],
    minArgs: 3,
    variadic: false,
    snippet: 'memcpy(${1:dest}, ${2:src}, ${3:n});',
  },
];
