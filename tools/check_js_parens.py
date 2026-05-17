import glob
files=glob.glob('web/**/*.js', recursive=True)
for f in files:
    s=open(f,encoding='utf-8').read()
    par=s.count('(')-s.count(')')
    br=s.count('{')-s.count('}')
    sq=s.count('[')-s.count(']')
    if par!=0 or br!=0 or sq!=0:
        print(f, 'paren',par,'brace',br,'brack',sq)
