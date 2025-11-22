/* eslint-disable */
/**
* Auto generated file - DO NOT EDIT!
* # Helium Server Type Definitions    
**/
import type { getServerEnv as method_0_type } from './server/env';
import type { getIP as method_1_type } from './server/get-ip';
import type { getProfile as method_2_type } from './server/profile';
import type { updateProfile as method_3_type } from './server/profile';
import type { getTasks as method_4_type } from './server/tasks/index';
import type { getTaskById as method_5_type } from './server/tasks/index';
import type { createTask as method_6_type } from './server/tasks/index';
import type { deleteTask as method_7_type } from './server/tasks/index';
import type { editTask as method_8_type } from './server/tasks/index';

declare module 'helium/server' {
export const getServerEnv: import('helium/client').MethodStub<
    Parameters<typeof method_0_type['handler']>[0],
    Awaited<ReturnType<typeof method_0_type['handler']>>
>;
export const getIP: import('helium/client').MethodStub<
    Parameters<typeof method_1_type['handler']>[0],
    Awaited<ReturnType<typeof method_1_type['handler']>>
>;
export const getProfile: import('helium/client').MethodStub<
    Parameters<typeof method_2_type['handler']>[0],
    Awaited<ReturnType<typeof method_2_type['handler']>>
>;
export const updateProfile: import('helium/client').MethodStub<
    Parameters<typeof method_3_type['handler']>[0],
    Awaited<ReturnType<typeof method_3_type['handler']>>
>;
export const getTasks: import('helium/client').MethodStub<
    Parameters<typeof method_4_type['handler']>[0],
    Awaited<ReturnType<typeof method_4_type['handler']>>
>;
export const getTaskById: import('helium/client').MethodStub<
    Parameters<typeof method_5_type['handler']>[0],
    Awaited<ReturnType<typeof method_5_type['handler']>>
>;
export const createTask: import('helium/client').MethodStub<
    Parameters<typeof method_6_type['handler']>[0],
    Awaited<ReturnType<typeof method_6_type['handler']>>
>;
export const deleteTask: import('helium/client').MethodStub<
    Parameters<typeof method_7_type['handler']>[0],
    Awaited<ReturnType<typeof method_7_type['handler']>>
>;
export const editTask: import('helium/client').MethodStub<
    Parameters<typeof method_8_type['handler']>[0],
    Awaited<ReturnType<typeof method_8_type['handler']>>
>;
}
