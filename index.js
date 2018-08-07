(function(w) {
    const tagsToReplace = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">"
    };

    function tpl(param) {
        let html = document
            .querySelector("body")
            .innerHTML.replace(/[\r\n]/g, "")
            .replace(/<script.*?>.*?<\/script>/gi, "");

        let blockStack = [];
        let blockID = 0;
        let astTree = [];

        param._s = str => str;
        param._f = (name, str) => name(str);

        function parse(html = "") {
            // 匹配正则
            const startMatchs = html.match(/{{|{%/) || {};
            const isBlock = startMatchs[0] === "{%";
            const startIndex = startMatchs.index;

            if (startIndex !== 0) {
                let len = html.length;
                let text = html.slice(0, startIndex || len);

                if (text.trim()) {
                    let obj = {
                        type: 1,
                        text
                    };
                    if (blockStack.length) {
                        if (!blockStack[blockStack.length - 1].children) {
                            blockStack[blockStack.length - 1].children = [];
                        }

                        blockStack[blockStack.length - 1].children.push(obj);
                    } else {
                        astTree.push(obj);
                    }
                }

                if (html.slice(startIndex || len).length) {
                    return parse(html.slice(startIndex || len));
                }

                return;
            }

            const endIndex = html.indexOf(isBlock ? "%}" : "}}");

            if (endIndex === -1) {
                astTree.push({
                    type: 1,
                    text: html.slice(0, 2)
                });

                if (html.slice(2).length) {
                    return parse(html.slice(2));
                }
            }

            if (isBlock) {
                // 块级作用域
                let item = html
                    .trim()
                    .slice(startIndex + 2, endIndex)
                    .trim();
                let block = "";
                let isElse = false;

                // 结束
                if (item === "}") {
                    // 出栈
                    let last = blockStack.pop();

                    if (blockStack.length) {
                        if (!blockStack[blockStack.length - 1].children) {
                            blockStack[blockStack.length - 1].children = [];
                        }

                        blockStack[blockStack.length - 1].children.push(last);
                    } else {
                        astTree.push(last);
                    }

                    return parse(html.slice(endIndex + 2));
                }

                if (item.indexOf("if") !== -1 || item.indexOf("else") !== -1) {
                    block = "if";
                    if (item.indexOf("if") !== 0) {
                        block = "else if";
                        // else if or else
                        isElse = true;
                    }
                } else if (item.includes("for")) {
                    block = "for";
                }

                let matchs = [...new Set(item.match(/\((.*?)\)/))];

                item = (matchs[1] || "").replace(
                    /(&lt)?(&gt)?(&amp)?;?/g,
                    replaceTag
                );

                if (isElse) {
                    let last = blockStack.pop();

                    blockStack.push({
                        ...{
                            type: 3,
                            block,
                            id: last.id
                        },
                        ...(item ? item : { item: last.item })
                    });

                    astTree.push(last);
                } else {
                    blockStack.push({
                        type: 3,
                        block,
                        item,
                        id: blockID,
                        edit: "start"
                    });

                    blockID++;
                }
            } else {
                // {{ 变量
                let text = html.slice(startIndex + 2, endIndex).trim();
                let tmpVarArr = text.split("|");

                let filter = "";

                let varStr = tmpVarArr[0].trim();

                if (tmpVarArr.length > 1) {
                    tmpVarArr.forEach((item, idx) => {
                        item = item.trim();
                        if (idx) {
                            filter = filter
                                ? `_f(${item}, ${filter})`
                                : `_f(${item}, ${varStr})`;
                        }
                    });
                }

                let obj = {
                    type: 2,
                    text: `{{${text}}}`,
                    expression: filter ? filter : `_s(${varStr})`
                };

                if (blockStack.length) {
                    if (!blockStack[blockStack.length - 1].children) {
                        blockStack[blockStack.length - 1].children = [];
                    }

                    blockStack[blockStack.length - 1].children.push(obj);
                } else {
                    astTree.push(obj);
                }
            }

            return parse(html.slice(endIndex + 2));
        }

        function compile(astTree) {
            let str = "";

            astTree.forEach(item => {
                if (item.type === 1) {
                    str += item.text;
                } else if (item.type === 2) {
                    str += genVar(item);
                } else if (item.type === 3) {
                    // if
                    if (item.block.includes("if")) {
                        str += genIf(item, param);
                    } else {
                        str += genFor(item, param);
                    }
                }
            });

            return str;
        }

        function genIf(ast, scope = param) {
            let varN = ast.item.split(/[=><]/g)[0].trim();

            let ifR = new Function(varN, "return " + ast.item)(param[varN]);

            ifR = ast.block === "if" ? ifR : !ifR;

            if (!ifR) return "";

            let str = "";

            ast.children.forEach(item => {
                if (item.type === 3) {
                    if (item.block.includes("if")) {
                        str += genIf(item);
                    } else {
                        str += genFor(item);
                    }
                } else if (item.type === 2) {
                    str += genVar(item);
                } else {
                    str += item.text;
                }
            });

            return str;
        }

        function genVar(ast, scope = param) {
            let expression = ast["expression"];

            return new Function(
                "scope",
                "expression",
                `with(scope) { return ${expression} }`
            )(scope, expression);
        }

        function genFor(ast, scope = param) {
            let params = ast.item.split(";");
            let tmp;

            tmp = params[0].split("=");

            let varName = tmp[0]
                .trim()
                .substring(3)
                .trim();
            let varVal = ~~tmp[1].trim();

            let condition = ~~params[1].split(/[<>=]={0}/g)[1].trim();

            tmp = params[2].trim();
            let way = tmp.substr(tmp.length - 2);

            let str = "";

            for (let i = varVal; i < condition; way === "++" ? i++ : i--) {
                ast.children.forEach(item => {
                    let tmpScope = { ...scope, ...{ [varName]: i } };
                    if (item.type === 3) {
                        if (item.block.includes("if")) {
                            str += genIf(item, tmpScope);
                        } else {
                            str += genFor(item, tmpScope);
                        }
                    } else if (item.type === 2) {
                        str += genVar(item, tmpScope);
                    } else {
                        str += item.text;
                    }
                });
            }
            return str;
        }

        parse(html);

        let htmlStr = compile(astTree);

        document.querySelector("body").innerHTML = htmlStr;
    }

    function replaceTag(tag) {
        return tagsToReplace[tag] || tag;
    }

    w.tpl = tpl;
})(window);
