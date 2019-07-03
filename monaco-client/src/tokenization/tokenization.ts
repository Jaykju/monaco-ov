'use strict';

import { OvlTokenProvider } from "./OvlTokenProvider";
import { TokenClass } from "../monaco-configuration/enums";

export async function createTokenizationSupport(classifiers: [string, TokenClass][]): Promise<monaco.languages.TokensProvider> {
	return new OvlTokenProvider(getRegEx(classifiers));
}

function getRegEx(stringList: [string, TokenClass][]): [RegExp, TokenClass][] {
	console.log(stringList);
	var returnList: [RegExp, TokenClass][] = [];

	stringList.forEach((element) => {
		if (!!element[0]) {
			returnList.push([new RegExp(element[0], "g"), element[1]]);
		}
	});

	return returnList;
}