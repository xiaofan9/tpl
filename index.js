(function(w) {
  const RMSCRIPT = /<script.*?>.*?<\/script>/gi;
  const RMLINE = /[\r\n]/g;
  const STARTTAG = /{{|{%/;
  const CONDITION = /\((.*?)\)/;

  const tagsToReplace = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">"
  };

  w.tpl = tpl;

  function tpl(param) {
    let body = document.querySelector("body");
    let html = body.innerHTML.replace(RMLINE, "").replace(RMSCRIPT, "");

    // 块级栈
    let blockStack = [];
    let astTree = [];

    // 解析变量函数
    param._s = str => str;

    // 过滤器处理函数
    param._f = (name, str) => name(str);

    // 编译html字符串为ast语法树
    function parse(html = "") {
      // html 为空时
      if (!html.trim()) {
        blockStack = [];

        if (html.length) {
          return " ";
        }
        return "";
      }
      // 匹配正则
      const startMatchs = html.match(STARTTAG) || {};

      // 是否是块级作用域
      const isBlock = startMatchs[0] === "{%";
      const startIndex = startMatchs.index;

      if (startIndex !== 0) {
        let len = html.length;
        let text = html.slice(0, startIndex || len);

        if (text) {
          let ast = { type: 1, text };

          // 存在块级表明该文本节点在块级中
          if (blockStack.length) {
            if (!blockStack[blockStack.length - 1].children) {
              blockStack[blockStack.length - 1].children = [];
            }

            blockStack[blockStack.length - 1].children.push(ast);
          } else {
            astTree.push(ast);
          }

          if (html.slice(startIndex || len).length) {
            return parse(html.slice(startIndex || len));
          }
        }

        blockStack = [];

        return;
      }

      const endIndex = html.indexOf(isBlock ? "%}" : "}}");

      // html 只有 {{ 或 {% 时，没有 }} 或 %} 处理语句
      if (endIndex === -1) {
        let ast = { type: 1, text: html.slice(0, 2) };

        if (blockStack.length) {
          if (!blockStack[blockStack.length - 1].children) {
            blockStack[blockStack.length - 1].children = [];
          }

          blockStack[blockStack.length - 1].children.push(ast);
        } else {
          astTree.push(ast);
        }

        if (html.slice(2).length) {
          return parse(html.slice(2));
        }

        return;
      }

      // 块级作用域
      if (isBlock) {
        // 拿到{% %} 里面的东西
        let item = html
          .trim()
          .slice(startIndex + 2, endIndex)
          .trim();
        let block = "";
        let isElse = false;

        // end结束
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

        // 拿到内部的是for 还是 if
        if (item.indexOf("if") !== -1 || item.indexOf("else") !== -1) {
          block = "if";
          if (item.indexOf("if") !== 0) {
            block = "else if";
            isElse = true;
          }
        } else if (item.includes("for")) {
          block = "for";
        }
        // 拿到条件语句
        let matchs = [...new Set(item.match(CONDITION))];

        // 对条件语句进行标签替换，innerHTML 拿到的 > < = 默认会被转义
        item = (matchs[1] || "").replace(/(&lt)?(&gt)?(&amp)?;?/g, replaceTag);

        let ast = {
          type: 3,
          block,
          item
        };

        // 如果是else 或者 else if
        if (isElse) {
          let last = blockStack.pop();

          blockStack.push({
            ...ast,
            ...(ast.item ? ast.item : { item: last.item }) // else 拿 if的判断语句，else if 用自己的
          });

          astTree.push(last);
        } else {
          blockStack.push(ast);
        }
      } else {
        // {{ 变量
        let text = html.slice(startIndex + 2, endIndex).trim();
        // 切割var字串，看有没有过滤器的存在。
        let tmpVarArr = text.split("|");

        // 过滤器函数字符串
        let f = "";

        // 变量字串
        let varStr = tmpVarArr.shift().trim();

        if (tmpVarArr.length) {
          tmpVarArr.forEach((item, idx) => {
            let f_ = item.trim(); // 过滤器函数名
            f = f ? `_f(${f_}, ${f})` : `_f(${f_}, ${varStr})`;
          });
        }

        let ast = {
          type: 2,
          item: `{{${text}}}`,
          expression: f || `_s(${varStr})`
        };

        if (blockStack.length) {
          if (!blockStack[blockStack.length - 1].children) {
            blockStack[blockStack.length - 1].children = [];
          }

          blockStack[blockStack.length - 1].children.push(ast);
        } else {
          astTree.push(ast);
        }
      }

      return parse(html.slice(endIndex + 2));
    }

    // 处理ast 语法，将其转化成html字串
    function generate() {
      let html = "";

      astTree.forEach(item => {
        if (item.type === 1) {
          html += item.text;
        } else if (item.type === 2) {
          html += genVar(item);
        } else if (item.type === 3) {
          if (item.block.includes("if")) {
            html += genIf(item, param);
          } else {
            html += genFor(item, param);
          }
        }
      });

      return html;
    }

    // 处理if 语句
    function genIf(ast, scope = param) {
      let str = "";

      let result = new Function("scope", `with(scope) { return ${ast.item} }`)(
        scope
      );

      // 旧版本写法
      // let varName = ast.item.split(/[=><]/g)[0].trim();

      // let result = new Function(varName, "return " + ast.item)(scope[varName]);

      result = ast.block === "if" ? result : !result;

      // 为假不进行下一步处理
      if (!result) return str;

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

    // 处理变量函数
    function genVar(ast, scope = param) {
      let expression = ast["expression"];

      return new Function(
        "scope",
        "expression",
        `with(scope) { return ${expression} }`
      )(scope, expression);
    }

    // 处理for循环
    function genFor(ast, scope = param) {
      let params = ast.item.split(";").map(i => i.trim());
      let tmp = params[0].split("=").map(i => i.trim());

      // 解析语句,拿到要用的词句
      let varName = tmp[0].substring(3).trim();
      let varVal = ~~tmp[1];

      let condition = ~~params[1].split(/[<>=]={0}/g)[1].trim();

      let way = params[2].substr(params[2].length - 2);

      let str = "";

      for (let i = varVal; i < condition; way === "++" ? i++ : i--) {
        let scope_;
        ast.children.forEach(item => {
          scope_ = { ...scope, ...{ [varName]: i } };

          if (item.type === 3) {
            if (item.block.includes("if")) {
              str += genIf(item, scope_);
            } else {
              str += genFor(item, scope_);
            }
          } else if (item.type === 2) {
            str += genVar(item, scope_);
          } else {
            str += item.text;
          }
        });
      }
      return str;
    }

    parse(html);

    // console.log(astTree);
    // let htmlStr = generate(astTree);

    body.innerHTML = generate(astTree);
  }

  function replaceTag(tag) {
    return tagsToReplace[tag] || tag;
  }
})(window);
