// Copyright 2021 SardineFish
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
//     http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

type HTTPMethodsWithoutBody = "GET" | "HEAD" | "CONNECT" | "DELETE" | "OPTIONS";
type HTTPMethodsWithBody = "POST" | "PUT" | "PATCH";
type HTTPMethods = HTTPMethodsWithBody | HTTPMethodsWithoutBody;

type TypeNames = "number" | "string" | "boolean" | "string[]";

type TypeOfName<T> =
    T extends "number"
    ? number
    : T extends "string"
    ? string
    : T extends "boolean"
    ? boolean
    : T extends "string[]"
    ? string[]
    : never;

type Validator<T> = (key: string, value: T) => T;

type ParamInfo<T extends TypeNames> = T extends any ? {
    type: T,
    validator: Validator<TypeOfName<T>>,
    optional?: true,
} : never;


type OptionalParams<T extends { [key: string]: ParamInfo<TypeNames> }> = {
    [key in keyof T as T[key]["optional"] extends true ? key : never]: TypeOfName<T[key]["type"]>;
}
type RequiredParams<T extends { [key: string]: ParamInfo<TypeNames> }> = {
    [key in keyof T as T[key]["optional"] extends true ? never : key]: TypeOfName<T[key]["type"]>;
}

type ValueType<T extends ParamsDeclare> = Required<RequiredParams<T>> & Partial<OptionalParams<T>>;
// {
//     [key in keyof T]: TypeOfName<T[key]["type"]>
// }

type ParamsDeclare = {
    [key: string]: ParamInfo<TypeNames>,
}
type SimpleParamsDeclare = {
    [key: string]: ParamInfo<TypeNames> | TypeNames;
}
type FullParamsDeclare<T extends SimpleParamsDeclare> = {
    [key in keyof T]: ParamInfo<TypeNames> & (T[key] extends TypeNames ? ParamInfo<T[key]> : T[key]);
}

type ApiFunction<Path extends ParamsDeclare, Query extends ParamsDeclare, Data extends ParamsDeclare | undefined, Response>
    = Data extends undefined
    ? (params: ValueType<Path> & ValueType<Query>) => Promise<Response>
    : (params: ValueType<Path> & ValueType<Query>, body: ValueType<Data & ParamsDeclare>) => Promise<Response>;


interface ErrorResponse
{
    status: ">_<";
    timestamp: number;
    code: number;
    msg: string;
}

interface SuccessResponse<T>
{
    status: "^_^";
    timestamp: number;
    data: T
}

function validateByPass<T>(_: string, value: T)
{
    return value;
}


function simpleParam<T extends SimpleParamsDeclare>(info: T): FullParamsDeclare<T>
{
    const params = {} as FullParamsDeclare<T>;
    for (const key in info)
    {
        const value = info[key];
        switch (info[key])
        {
            case "number":
                params[key] = <ParamInfo<TypeNames>>{
                    type: "number",
                    validator: validateByPass,
                } as any;
                break;
            case "string":
                params[key] = <ParamInfo<"string">>{
                    type: "string",
                    validator: validateByPass,
                } as any;
                break;
            case "boolean":
                params[key] = <ParamInfo<"boolean">>{
                    type: "boolean",
                    validator: validateByPass,
                } as any;
                break;
            case "string[]":
                params[key] = <ParamInfo<"string[]">>{
                    type: "string[]",
                    validator: validateByPass,
                } as any;
                break;
            default:
                params[key] = value as any;
        }
    }
    return params;
}

function validateNonEmpty(key: string, text: string): string
{
    if (/^\s*$/.test(text))
        throw new APIError(ClientErrorCode.InvalidParameter, `'${key}' cannot be empty`);
    return text;
}

enum ClientErrorCode
{
    Error = -1,
    InvalidParameter = -2,
    NetworkFailure = -3,
    ParseError = -4,
}

class APIError extends Error
{
    code: number;
    constructor(code: number, message: string)
    {
        super(message);
        this.code = code;
    }
}

class ApiBuilder<Method extends HTTPMethods, Path extends ParamsDeclare, Query extends ParamsDeclare, Data extends ParamsDeclare | undefined, Response>
{
    private method: Method;
    private url: string;
    private pathInfo: Path;
    private queryInfo: Query;
    private dataInfo: Data;
    private redirectOption?: "follow" | "error" | "manual";

    constructor(method: Method, url: string, path: Path, query: Query, data: Data)
    {
        this.method = method;
        this.url = url;
        this.pathInfo = path;
        this.queryInfo = query;
        this.dataInfo = data;
    }

    path<NewPath extends SimpleParamsDeclare>(path: NewPath)
    {
        return new ApiBuilder<Method, FullParamsDeclare<NewPath>, Query, Data, Response>(this.method, this.url, simpleParam(path), this.queryInfo, this.dataInfo);
    }
    query<NewQuery extends SimpleParamsDeclare>(query: NewQuery)
    {
        return new ApiBuilder<Method, Path, FullParamsDeclare<NewQuery>, Data, Response>(this.method, this.url, this.pathInfo, simpleParam(query), this.dataInfo);
    }
    body<NewData extends SimpleParamsDeclare>(data: NewData)
    {
        if (this.method === "POST" || this.method === "PATCH" || this.method === "PUT")
        {
            return new ApiBuilder<Method, Path, Query, FullParamsDeclare<NewData>, Response>(this.method, this.url, this.pathInfo, this.queryInfo, simpleParam(data));
        }
        else
        {
            throw new APIError(ClientErrorCode.Error, `HTTP Method ${this.method} should not have body.`);
        }
    }
    redirect(redirect: "follow" | "error" | "manual")
    {
        this.redirectOption = redirect;
        return this;
    }
    response<Response>(): ApiFunction<Path, Query, Data, Response>
    {
        const builder = new ApiBuilder<Method, Path, Query, Data, Response>(this.method, this.url, this.pathInfo, this.queryInfo, this.dataInfo);
        return builder.send.bind(builder) as ApiFunction<Path, Query, Data, Response>;
    }
    private async send(params: ValueType<Path> | ValueType<Query>, data: ValueType<Data & ParamsDeclare>): Promise<Response>
    {
        let url = this.url;
        for (const key in this.pathInfo)
        {
            const value = (params as ValueType<Path> as any)[key];
            if (value === undefined)
            {
                if (this.pathInfo[key].optional)
                {
                    url = url.replace(`{${key}}`, "");
                    continue;
                }
                throw new APIError(ClientErrorCode.InvalidParameter, `Missing path '${key}'`);
            }
            url = url.replace(`{${key}}`, this.pathInfo[key].validator(key, value as never).toString());
        }
        const queryParams = [];
        for (const key in this.queryInfo) 
        {
            const value = (params as Partial<ValueType<Query>> as any)[key];
            if (value === undefined && !this.queryInfo[key].optional)
                throw new APIError(ClientErrorCode.InvalidParameter, `Missing query param '${key}'`);
            else if (value !== undefined)
                queryParams.push(`${key}=${encodeURIComponent(this.queryInfo[key].validator(key, value as never).toString())}`);
        }
        if (queryParams.length > 0)
            url = url + "?" + queryParams.join("&");

        if (this.dataInfo !== undefined)
        {
            for (const key in this.dataInfo)
            {
                const dataInfo = this.dataInfo[key];
                const value = (data as any)[key];
                if (value === undefined && !dataInfo.optional)
                    throw new APIError(ClientErrorCode.InvalidParameter, `Missing field '${key} in request body'`);
                else if (value !== undefined)
                    (data as any)[key] = dataInfo.validator(key, value as never);
            }
        }

        let response: globalThis.Response;
        try
        {
            response = await fetch(url, {
                method: this.method,
                headers: {
                    "Content-Type": "application/json",
                },
                redirect: this.redirectOption,
                body: this.dataInfo === undefined ? undefined : JSON.stringify(data as any),
            });
        }
        catch (err)
        {
            console.error(err);
            throw new APIError(ClientErrorCode.NetworkFailure, "Failed to send request.");
        }

        if (response.status >= 400)
        {
            const body = await this.parseBody<ErrorResponse>(response);
            console.warn(`Server response error: ${body.code.toString(16)}: ${body.msg}`);
            throw new APIError(body.code, body.msg);
        }

        const responseBody = await this.parseBody<Response>(response);
        return responseBody;
    }
    private async parseBody<T>(response: globalThis.Response)
    {
        try
        {
            const body = await response.json() as T;
            return body as T;
        }
        catch (err)
        {
            console.error(err);
            throw new APIError(ClientErrorCode.ParseError, "Failed to parse response body.");
        }
    }
}

export function api<Method extends HTTPMethodsWithBody>(method: Method, url: string): ApiBuilder<Method, {}, {}, {}, any>
export function api<Method extends HTTPMethodsWithoutBody>(method: Method, url: string): ApiBuilder<Method, {}, {}, undefined, any>
export function api<Method extends HTTPMethods>(method: Method, url: string): ApiBuilder<Method, {}, {}, {} | undefined, any>
{
    switch (method)
    {
        case "POST":
        case "PUT":
        case "PATCH":
            return new ApiBuilder<Method, {}, {}, {}, null>(method, url, {}, {}, {});
        default:
            return new ApiBuilder<Method, {}, {}, undefined, null>(method, url, {}, {}, undefined);
    }
}